// blueprint bot: the Bun sidecar the Tauri tray launches.
//   portal  127.0.0.1:portalPort  -> exposed via Cloudflare quick tunnel, Steam-login gated
//   rpc     127.0.0.1:rpcPort     -> `bot` CLI inside WSL (mirrored networking), token-gated
//   servers one Rust+ websocket per paired server, plugin runtime + recorder
import {
  Bindings,
  Db,
  Pairing,
  Proposal,
  Rpc,
  RustPlus,
  Server,
  Tunnel,
  Workspace,
} from "@blueprint/core";
import { Starters, Validate, type World } from "@blueprint/dsl";
import { Effect, Ref, Schedule, Stream } from "effect";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as AgentRunner from "./AgentRunner.ts";
import * as Config from "./Config.ts";
import * as GameData from "./GameData.ts";
import * as HarnessAuth from "./HarnessAuth.ts";
import * as Notify from "./Notify.ts";
import * as Sandbox from "./Sandbox.ts";
import * as SteamLogin from "./SteamLogin.ts";

if (process.argv.includes("--self-test")) await (await import("./SelfTest.ts")).run();

let config = await Config.load();

// Under the tray, exit when the tray does (crash, kill, an installer stopping it). Otherwise this
// orphan keeps the ports and serves stale code after an update. Signal 0 only tests existence.
const trayPid = Number(process.env.BLUEPRINT_TRAY_PID);

if (trayPid > 0)
  setInterval(() => {
    try {
      process.kill(trayPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2000).unref();

const home = Config.dataDir();

const db = Db.open(join(home, "blueprint.db"));

const workspaceDir = join(home, "workspace");

/** The only directory the agent can write. Plugins leave it only via propose -> confirm. */
const agentShare = join(home, "agent-share");

/** Fresh copy of active plugins for the agent to read/edit; old drafts are discarded per job. */
const refreshAgentShare = async () => {
  rmSync(agentShare, { recursive: true, force: true });
  mkdirSync(join(agentShare, "plugins"), { recursive: true });

  for (const l of Effect.runSync(Ref.get(pluginsRef)))
    await Bun.write(
      join(agentShare, "plugins", `${l.plugin.name}.json`),
      `${JSON.stringify(l.plugin, null, 2)}\n`,
    );

  await Bun.write(join(agentShare, "AGENTS.md"), "Draft plugins in plugins/. Use the bot CLI.\n");
};

const prepareSandbox = async () => {
  await refreshAgentShare();
  Sandbox.prepare(home, agentShare);
  rebindRpc();
};

const BOT_PREFIX = "[bot] ";

await Workspace.init(workspaceDir, Starters.all());

// Game data for the agent (`bot items`, `bot raid`, rg/jq). Refreshed on start and daily.
const syncGameData = () =>
  GameData.sync(join(home, "rust-items-json")).catch((e) =>
    console.warn("game data sync failed", e),
  );

void syncGameData();

setInterval(syncGameData, 24 * 3600_000);

const pluginsRef = Effect.runSync(Ref.make<ReadonlyArray<Workspace.Loaded>>([]));

const reloadPlugins = async () => {
  const { loaded, invalid } = await Workspace.load(workspaceDir);

  for (const i of invalid) console.warn(`plugin ${i.file} invalid:`, i.problems[0]?.message);

  Effect.runSync(Ref.set(pluginsRef, loaded));
};

await reloadPlugins();

// ── Live state shared by portal, RPC and agent ──────────────────────────────────────────────────
const worlds = new Map<string, World>();

/** Map JPEG per server, fetched once per connection on first portal request. */
const mapFetchers = new Map<
  string,
  () => Promise<
    { jpgImage?: string; width?: number; height?: number; oceanMargin?: number } | undefined
  >
>();

const mapCache = new Map<string, Promise<{ jpg: Uint8Array; oceanMargin: number } | undefined>>();

const chatSinks = new Map<string, (line: string) => Promise<void>>();

const replies = new Map<string, string>();

type Activity = { at: number; server: string; plugin: string; message: string };

const activity: Activity[] = [];

const logActivity = (server: string) => (e: { plugin: string; message: string }) => {
  activity.unshift({ at: Date.now(), server, ...e });
  activity.length = Math.min(activity.length, 200);
};

const sessions = new Map<string, string>();

const pending = new Map<string, Proposal.Pending>();

let publicUrl = `http://127.0.0.1:${config.portalPort}`;

/** token -> requester SID64, live only while that requester's agent job runs. */
const rpcTokens = new Map<string, string>();

const anyServer = (id: string | undefined) => id ?? [...worlds.keys()][0];

const chatAll = async (line: string) => {
  for (const send of chatSinks.values()) await send(line);
};

// ── Portal ───────────────────────────────────────────────────────────────────────────────────────
const { attach } = await import("@blueprint/portal/src/lib/server/bot.ts");

attach({
  sessionSecret: config.sessionSecret,
  hostSteamId: () => config.hostSteamId,
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
  diff: (name, commit) => Workspace.diff(workspaceDir, name, commit),
  mapImage: (id) => {
    const cached = mapCache.get(id);

    if (cached) return cached;

    const fetcher = mapFetchers.get(id);

    if (!fetcher) return Promise.resolve(undefined);

    const p = fetcher().then((m) =>
      m?.jpgImage
        ? { jpg: Buffer.from(m.jpgImage, "base64"), oceanMargin: m.oceanMargin ?? 0 }
        : undefined,
    );

    mapCache.set(id, p);

    return p;
  },
  pairing: () => ({ signedIn: config.rustplus !== undefined, hostSteamId: config.hostSteamId }),
  pair: () => pair(),
  activity: () => activity,
  saveHarnessCredential: async (c) => {
    await prepareSandbox();
    HarnessAuth.save(c);
  },
  settings: () => ({
    botName: config.botName,
    allowlist: config.allowlist,
    harness: config.harness,
    model: config.model,
    ntfyTopic: config.ntfyTopic,
  }),
  saveSettings: async (next) => {
    config = Config.merge(config, next);
    await Config.save(config);
  },
  importPlugin: async (url, by) => {
    // Gallery plugins are PRs to a GitHub repo; only fetch from raw GitHub (no SSRF to LAN).
    if (new URL(url).origin !== "https://raw.githubusercontent.com") return ["not a gallery URL"];

    const res = await fetch(url, { redirect: "error" });

    if (!res.ok) return [`download failed: ${res.status}`];

    const r = Validate.validate(await res.json());

    if (!r.ok) return r.problems.map((p) => `${p.path} ${p.message}`.trim());

    await Workspace.activate(workspaceDir, r.plugin, by);
    await reloadPlugins();

    return [];
  },
});

// Packaged: Tauri passes the bundled portal dir. Dev: the sibling app's build output.
const portalDir = process.env.BLUEPRINT_PORTAL ?? join(import.meta.dir, "../../portal/build");

// adapter-node assumes https unless told otherwise, which breaks SvelteKit's same-origin form
// check on http://127.0.0.1. Read the protocol from a header we set ourselves (never the client's):
// https behind the Cloudflare tunnel, http on loopback. Must be set before the handler loads.
process.env.PROTOCOL_HEADER = "x-blueprint-proto";

const { handler } = await import(join(portalDir, "handler.js"));

// Another blueprint (or anything) on our ports means a second copy; exit with a clear message
// instead of a stack trace. The tray app is single-instance, so this is mostly dev or a stale exe.
const portInUse = (port: number) => (e: NodeJS.ErrnoException) => {
  if (e.code !== "EADDRINUSE") throw e;

  console.error(`blueprint: port ${port} is in use. Is blueprint already running?`);
  Notify.toast("blueprint", `Port ${port} is in use. Is blueprint already running?`);
  process.exit(1);
};

createServer((req, res) => {
  req.headers["x-blueprint-proto"] = req.headers["cf-connecting-ip"] ? "https" : "http";
  handler(req, res);
})
  .on("error", portInUse(config.portalPort))
  .listen(config.portalPort, "127.0.0.1");

// ── RPC for the sandboxed CLI ────────────────────────────────────────────────────────────────────
// Windows: listen on the WSL vEthernet address so the sandbox can reach us; never 0.0.0.0 (LAN).
// Before the sandbox is installed no agent can run, so loopback is fine; prepareSandbox restarts
// the RPC listener on the adapter once the distro exists (see rebindRpc).
let rpcHost = (process.platform === "win32" && Sandbox.bootAndAddress()) || "127.0.0.1";

const rpcServe = () =>
  Bun.serve({
    hostname: rpcHost,
    port: config.rpcPort,
    fetch: Rpc.handler({
      requesterFor: (token) => rpcTokens.get(token),
      world: (id) => worlds.get(anyServer(id) ?? ""),
      bindings: (id) => Effect.runSync(Ref.get(bindingRef(anyServer(id) ?? ""))),
      recorded: (id, from) => Db.recorded(db, anyServer(id) ?? "", from),
      propose: async (requester, r) => {
        const p = {
          plugin: r.plugin,
          code: Proposal.makeCode(),
          expires: Date.now() + Proposal.TTL_MS,
        };

        const id = randomBytes(6).toString("base64url");

        const replaces = Effect.runSync(Ref.get(pluginsRef)).find(
          (l) => l.plugin.name === r.plugin.name,
        )?.plugin;

        pending.set(requester, p);
        replies.set(id, JSON.stringify(r.plugin, null, 2));

        for (const line of Proposal.prompt(p, replaces, `${publicUrl}/r/${id}`, config.botName))
          await chatAll(line);

        return `awaiting "@${config.botName} yes ${p.code}" from the requester in team chat`;
      },
    }),
  });

let rpcServer: ReturnType<typeof rpcServe> | undefined;

try {
  rpcServer = rpcServe();
} catch (e) {
  // SAFETY: Bun.serve throws Node-style errno errors; portInUse rethrows anything else.
  portInUse(config.rpcPort)(e as NodeJS.ErrnoException);
}

/** First sandbox setup creates the WSL adapter; move the RPC listener onto it (once). */
function rebindRpc() {
  if (process.platform !== "win32" || rpcHost !== "127.0.0.1") return;

  const ip = Sandbox.bootAndAddress();

  if (ip === undefined) return;

  rpcServer?.stop();
  rpcHost = ip;
  rpcServer = rpcServe();
}

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
  issueRpcToken: (steamId) => {
    const token = randomBytes(24).toString("base64url");

    rpcTokens.set(token, steamId);

    return { token, revoke: () => void rpcTokens.delete(token) };
  },
  rpcUrl: () => `http://${rpcHost}:${config.rpcPort}`,
  prepareSandbox,
});

/** "@bot yes" / "@bot undo" are handled here; everything else goes to the harness. */
const onAgentMessage = async (steamId: string, name: string, text: string) => {
  const body = text.replace(new RegExp(`^\\s*@${config.botName}\\b[\\s,:]*`, "i"), "").trim();
  const isHost = steamId === config.hostSteamId || config.allowlist.includes(steamId);

  const yes = /^(?:yes|confirm|y)(?:\s+(\d{4}))?$/i.exec(body);

  if (isHost && yes) {
    const r = Proposal.confirm(pending.get(steamId), yes[1], Date.now());

    if (r.kind === "none") return chatAll(`${name}: nothing pending`);

    if (r.kind === "expired") {
      pending.delete(steamId);

      return chatAll(`${name}: that proposal expired, ask again`);
    }

    if (r.kind === "wrongCode")
      return chatAll(`${name}: include the 4-digit code from the proposal`);

    pending.delete(steamId);
    await Workspace.activate(workspaceDir, r.plugin, name);
    await reloadPlugins();

    return chatAll(`${r.plugin.name} is live`);
  }

  if (isHost && /^undo$/i.test(body)) {
    const undone = Workspace.undoLast(workspaceDir, name);

    await reloadPlugins();

    return chatAll(undone ? `undid ${undone.slice(0, 7)}` : "nothing to undo");
  }

  return runAgent(steamId, name, text);
};

// ── Servers ──────────────────────────────────────────────────────────────────────────────────────
/** Per-server device bindings, loaded from the workspace and updated by pair notifications. */
const bindingRefs = new Map<string, Ref.Ref<ReadonlyArray<Server.Binding>>>();

const bindingRef = (serverId: string) => {
  const existing = bindingRefs.get(serverId);

  if (existing) return existing;

  const ref = Effect.runSync(Ref.make<ReadonlyArray<Server.Binding>>([]));

  bindingRefs.set(serverId, ref);
  void Bindings.read(workspaceDir, serverId).then((f) =>
    Effect.runSync(Ref.set(ref, Bindings.forServer(f))),
  );

  return ref;
};

const saveBindings = async (serverId: string, file: Bindings.File, message: string) => {
  await Bindings.write(workspaceDir, serverId, file);
  Workspace.commit(workspaceDir, message);
  Effect.runSync(Ref.set(bindingRef(serverId), Bindings.forServer(file)));
};

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
        bindings: bindingRef(s.id),
        onActivity: logActivity(s.name),
        onWipe: () =>
          Effect.promise(() =>
            saveBindings(s.id, { devices: [], bindings: {} }, `wipe ${s.name}: reset bindings`),
          ),
        onAgentMessage: (id, name, text) => Effect.promise(() => onAgentMessage(id, name, text)),
        notify: (text, channel) =>
          Effect.promise(() => Notify.send(config.ntfyTopic, text, channel).catch(() => undefined)),
        isAgentMessage: (text) => new RegExp(`^\\s*@${config.botName}\\b`, "i").test(text),
        botPrefix: BOT_PREFIX,
      });

      mapFetchers.set(s.id, () => Effect.runPromise(live.map));
      yield* live.world.pipe(Stream.runForEach((w) => Effect.sync(() => w && worlds.set(s.id, w))));
    }),
  ).pipe(
    Effect.tapError((e) => Effect.logWarning(`server ${s.name} disconnected`, e)),
    Effect.retry(Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("1 minute")])),
  );

const running = new Set<string>();

const startServer = (s: Db.ServerRow) => {
  if (running.has(s.id)) return;

  running.add(s.id);
  Effect.runFork(runServer(s));
};

for (const s of Db.listServers(db)) startServer(s);

// ── Pairing ──────────────────────────────────────────────────────────────────────────────────────
// In-game "Pair with Server" arrives over FCM; servers are added and started automatically.
let stopListening: (() => void) | undefined;

const listenForPairs = () => {
  const rp = config.rustplus;

  if (rp === undefined) return;

  stopListening?.();
  stopListening = Pairing.listen(
    { fcm: rp.fcm, expoPushToken: rp.expoPushToken },
    rp.persistentIds,
    (n, persistentId) => {
      config = {
        ...config,
        rustplus: { ...rp, persistentIds: [...rp.persistentIds, persistentId].slice(-200) },
      };
      void Config.save(config);

      if (n.type === "entity") {
        const kind = Bindings.kindOf(n.entityType);

        if (kind === undefined) return;

        const plugins = Effect.runSync(Ref.get(pluginsRef)).map((l) => l.plugin);

        void Bindings.read(workspaceDir, n.id).then((f) =>
          saveBindings(
            n.id,
            Bindings.addDevice(
              f,
              { entityId: n.entityId, kind, label: n.entityName ?? kind },
              plugins,
            ),
            `pair ${kind} ${n.entityId}`,
          ),
        );

        return;
      }

      const row = {
        id: n.id,
        name: n.name,
        ip: n.ip,
        port: n.port,
        playerId: n.playerId,
        playerToken: n.playerToken,
      };

      Db.upsertServer(db, row);
      startServer({ ...row, wipeTime: 0 });
      console.log(`paired ${n.name}`);
    },
  );
};

/** Portal "Pair" button: Steam sign-in on this PC, then register for pair notifications. */
const pair = async () => {
  const device = await Pairing.registerDevice();
  const { steamId, authToken } = await SteamLogin.signIn();

  await Pairing.registerPush(authToken, device.expoPushToken);
  config = {
    ...config,
    hostSteamId: config.hostSteamId === "" ? steamId : config.hostSteamId,
    rustplus: {
      authToken,
      expoPushToken: device.expoPushToken,
      fcm: device.fcm,
      persistentIds: [],
    },
  };
  await Config.save(config);
  listenForPairs();

  // The Rust+ auth token expires (~2 weeks). Re-registering push both refreshes and probes it; a
  // rejection means pair notifications have stopped and the host must sign in again.
  const checkRustPlusAuth = async () => {
    const rp = config.rustplus;

    if (rp === undefined) return;

    try {
      await Pairing.registerPush(rp.authToken, rp.expoPushToken);
    } catch (e) {
      // Drop the stale credentials so /pair offers sign-in again; pair history is kept in the db.
      config = Config.withoutRustPlus(config);
      await Config.save(config);
      stopListening?.();

      const msg = `Rust+ sign-in expired. Open the portal on this PC and sign in again (${e instanceof Error ? e.message : e}).`;

      Notify.toast("blueprint", msg);
      await chatAll("Rust+ sign-in expired: host, re-sign in from the portal on your PC.");
    }
  };

  setInterval(checkRustPlusAuth, 24 * 3600_000);
  void checkRustPlusAuth();

  return steamId;
};

listenForPairs();

// The Rust+ auth token expires (~2 weeks). Re-registering push both refreshes and probes it; a
// rejection means pair notifications have stopped and the host must sign in again.
const checkRustPlusAuth = async () => {
  const rp = config.rustplus;

  if (rp === undefined) return;

  try {
    await Pairing.registerPush(rp.authToken, rp.expoPushToken);
  } catch (e) {
    // Drop the stale credentials so /pair offers sign-in again; pair history is kept in the db.
    config = Config.withoutRustPlus(config);
    await Config.save(config);
    stopListening?.();

    const msg = `Rust+ sign-in expired. Open the portal on this PC and sign in again (${e instanceof Error ? e.message : e}).`;

    Notify.toast("blueprint", msg);
    await chatAll("Rust+ sign-in expired: host, re-sign in from the portal on your PC.");
  }
};

setInterval(checkRustPlusAuth, 24 * 3600_000);

void checkRustPlusAuth();

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

console.log(`blueprint running. portal http://127.0.0.1:${config.portalPort}, data ${home}`);
