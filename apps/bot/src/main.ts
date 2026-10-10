// better-rust bot: the Bun sidecar the Tauri tray launches.
//   portal  127.0.0.1:portalPort  -> exposed via Cloudflare quick tunnel, Steam-login gated
//   rpc     127.0.0.1:rpcPort     -> `bot` CLI inside WSL (mirrored networking), token-gated
//   servers one Rust+ websocket per paired server, plugin runtime + recorder
import { Db, Rpc, RustPlus, Server, Tunnel, Workspace } from "@better-rust/core";
import type { Plugin, World } from "@better-rust/dsl";
import { Effect, Ref, Schedule, Stream } from "effect";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import * as AgentRunner from "./AgentRunner.ts";
import * as Config from "./Config.ts";

const config = await Config.load();

const home = Config.dataDir();

const db = Db.open(join(home, "better-rust.db"));

const workspaceDir = join(home, "workspace");

const BOT_PREFIX = "[bot] ";

Workspace.init(workspaceDir);

const pluginsRef = Effect.runSync(Ref.make<ReadonlyArray<Workspace.Loaded>>([]));

const reloadPlugins = async () => {
  const { loaded, invalid } = await Workspace.load(workspaceDir);

  for (const i of invalid) console.warn(`plugin ${i.file} invalid:`, i.problems[0]?.message);

  Effect.runSync(Ref.set(pluginsRef, loaded));
};

await reloadPlugins();

// ── Live state shared by portal, RPC and agent ──────────────────────────────────────────────────
const worlds = new Map<string, World>();

const chatSinks = new Map<string, (line: string) => Promise<void>>();

const replies = new Map<string, string>();

const sessions = new Map<string, string>();

const pending = new Map<string, Plugin>();

let publicUrl = `http://127.0.0.1:${config.portalPort}`;

let rpcToken = randomBytes(24).toString("base64url");

const anyServer = (id: string | undefined) => id ?? [...worlds.keys()][0];

const chatAll = async (line: string) => {
  for (const send of chatSinks.values()) await send(line);
};

// ── Portal ───────────────────────────────────────────────────────────────────────────────────────
const { attach } = await import("@better-rust/portal/src/lib/server/bot.ts");

attach({
  sessionSecret: config.sessionSecret,
  hostSteamId: config.hostSteamId,
  allowlist: () => config.allowlist,
  publicUrl: () => publicUrl,
  servers: () =>
    Db.listServers(db).map((s) => ({ id: s.id, name: s.name, world: worlds.get(s.id) })),
  plugins: () =>
    Effect.runSync(Ref.get(pluginsRef)).map((l) => ({
      ...l,
      history: Workspace.history(workspaceDir, l.plugin.name),
    })),
  setEnabled: async (name, on, by) => {
    await Workspace.setEnabled(workspaceDir, name, on, by);
    await reloadPlugins();
  },
  rollback: async (name, commit, by) => {
    Workspace.rollback(workspaceDir, name, commit, by);
    await reloadPlugins();
  },
  reply: (id) => replies.get(id),
});

const { handler } = await import(join(import.meta.dir, "../../portal/build/handler.js"));

createServer(handler).listen(config.portalPort, "127.0.0.1");

// ── RPC for the sandboxed CLI ────────────────────────────────────────────────────────────────────
Bun.serve({
  hostname: "127.0.0.1",
  port: config.rpcPort,
  fetch: Rpc.handler({
    token: () => rpcToken,
    world: (id) => worlds.get(anyServer(id) ?? ""),
    bindings: () => [],
    recorded: (id, from) => Db.recorded(db, anyServer(id) ?? "", from),
    propose: async (r) => {
      const requester = [...sessions.keys()].at(-1) ?? config.hostSteamId;

      pending.set(requester, r.plugin);
      await chatAll(
        `${r.plugin.name}: ${r.plugin.description}`.slice(0, 120) +
          ` — reply @${config.botName} yes to activate`,
      );

      return "awaiting confirmation in team chat";
    },
  }),
});

// ── Agent ────────────────────────────────────────────────────────────────────────────────────────
const runAgent = AgentRunner.make({
  settings: () => ({
    name: config.botName,
    hostSteamId: config.hostSteamId,
    allowlist: config.allowlist,
    portalUrl: publicUrl,
  }),
  harness: () => ({ kind: config.harness, model: config.model }),
  chat: chatAll,
  sessions,
  replies,
  rotateRpcToken: () => (rpcToken = randomBytes(24).toString("base64url")),
  rpcUrl: `http://127.0.0.1:${config.rpcPort}`,
});

/** "@bot yes" / "@bot undo" are handled here; everything else goes to the harness. */
const onAgentMessage = async (steamId: string, name: string, text: string) => {
  const body = text.replace(new RegExp(`^\\s*@${config.botName}\\b[\\s,:]*`, "i"), "").trim();
  const isHost = steamId === config.hostSteamId || config.allowlist.includes(steamId);

  if (isHost && /^(yes|confirm|y)$/i.test(body) && pending.has(steamId)) {
    const plugin = pending.get(steamId)!;

    pending.delete(steamId);
    await Workspace.activate(workspaceDir, plugin, name);
    await reloadPlugins();

    return chatAll(`${plugin.name} is live`);
  }

  if (isHost && /^undo$/i.test(body)) {
    const undone = Workspace.undoLast(workspaceDir, name);

    await reloadPlugins();

    return chatAll(undone ? `undid ${undone.slice(0, 7)}` : "nothing to undo");
  }

  return runAgent(steamId, name, text);
};

// ── Servers ──────────────────────────────────────────────────────────────────────────────────────
const runServer = (s: Db.ServerRow) =>
  Effect.scoped(
    Effect.gen(function* () {
      const rp = yield* RustPlus.make({
        ip: s.ip,
        port: s.port,
        playerId: s.playerId,
        playerToken: s.playerToken,
      });

      chatSinks.set(s.id, (line) =>
        Effect.runPromise(
          Effect.ignore(
            rp.request("sendTeamMessage", { message: `${BOT_PREFIX}${line}`.slice(0, 128) }),
          ),
        ),
      );

      const live = yield* Server.run({
        serverId: s.id,
        db,
        rp,
        plugins: pluginsRef,
        bindings: yield* Ref.make<ReadonlyArray<Server.Binding>>([]),
        onAgentMessage: (id, name, text) => Effect.promise(() => onAgentMessage(id, name, text)),
        notify: (text) => Effect.sync(() => console.log(`[notify] ${text}`)),
        isAgentMessage: (text) => new RegExp(`^\\s*@${config.botName}\\b`, "i").test(text),
        botPrefix: BOT_PREFIX,
      });

      yield* live.world.pipe(Stream.runForEach((w) => Effect.sync(() => w && worlds.set(s.id, w))));
    }),
  ).pipe(
    Effect.tapError((e) => Effect.logWarning(`server ${s.name} disconnected`, e)),
    Effect.retry(Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("1 minute")])),
  );

for (const s of Db.listServers(db)) Effect.runFork(runServer(s));

// ── Tunnel ───────────────────────────────────────────────────────────────────────────────────────
const cloudflared =
  process.env.CLOUDFLARED ?? (process.platform === "win32" ? "cloudflared.exe" : "cloudflared");

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      publicUrl = yield* Tunnel.start(cloudflared, config.portalPort);
      console.log(`portal: ${publicUrl}`);
      yield* Effect.promise(() => chatAll(`portal: ${publicUrl}`));
      yield* Effect.never;
    }),
  ).pipe(Effect.tapError((e) => Effect.logWarning("tunnel unavailable; portal is local only", e))),
);

console.log(`better-rust running. portal http://127.0.0.1:${config.portalPort}, data ${home}`);
