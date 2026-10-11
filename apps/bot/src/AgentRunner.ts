// Runs one agent turn for a team chat request: ack, harness run (inside WSL on Windows),
// short reply in chat, full reply kept for the portal.
import { Agent, Harness } from "@blueprint/core";
import { randomUUID } from "node:crypto";
import * as HarnessAuth from "./HarnessAuth.ts";
import * as Sandbox from "./Sandbox.ts";

export interface Deps {
  readonly settings: () => Agent.Settings;
  readonly harness: () => { readonly kind: Harness.Kind; readonly model: string | undefined };
  /** Sends one team chat line (already prefixed and truncated by the caller's sink). */
  readonly chat: (line: string) => Promise<void>;
  /** Per-requester harness session id. */
  readonly sessions: Map<string, string>;
  readonly replies: Map<string, string>;
  /** Issues a token for the `bot` CLI tied to this requester; revoke when the job ends. */
  readonly issueRpcToken: (steamId: string) => {
    readonly token: string;
    readonly revoke: () => void;
  };
  /** Read per job: the RPC listener moves to the WSL adapter after first sandbox setup. */
  readonly rpcUrl: () => string;
  /** Windows: import/mount the WSL sandbox. Throws with a user-facing reason if unavailable. */
  readonly prepareSandbox: () => Promise<void>;
  /** Runs the harness; injectable for tests. */
  readonly run?: (
    argv: string[],
    env: Record<string, string>,
  ) => Promise<{ stdout: string; exitCode: number }>;
}

const spawnHarness = async (argv: string[], env: Record<string, string>) => {
  const proc = Bun.spawn(sandboxed(argv, env), {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const timeout = setTimeout(() => proc.kill(), 10 * 60_000);

  try {
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    return { stdout, exitCode };
  } finally {
    clearTimeout(timeout);
  }
};

/** On Windows, every harness runs inside the locked-down distro as the agent user. */
/** POSIX single-quote: the only safe way to pass arbitrary chat text through `sh -c`. */
export const shQuote = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;

/**
 * On Windows the harness runs in the sandbox distro as `agent`, with stored harness credentials
 * sourced first. The prompt comes from team chat, so every argument is single-quoted.
 */
export const sandboxed = (argv: string[], env: Record<string, string>) =>
  process.platform === "win32"
    ? [
        "wsl.exe",
        "-d",
        Sandbox.DISTRO,
        "-u",
        "agent",
        "--cd",
        "/workspace",
        "--",
        "sh",
        "-c",
        [
          HarnessAuth.ENV_PRELUDE,
          ...Object.entries(env).map(([k, v]) => `export ${k}=${shQuote(v)};`),
          "exec",
          ...argv.map(shQuote),
        ].join(" "),
      ]
    : argv;

export const make = (deps: Deps) => {
  const queue = Agent.makeQueue();
  // One sandbox, one Linux user: jobs must never overlap, or one requester's agent could read the
  // next one's token from /proc. Every job (any requester) runs in arrival order on this chain.
  let lane: Promise<void> = Promise.resolve();

  const serial = <A>(job: () => Promise<A>) => {
    const next = lane.then(job);

    lane = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  };

  const run = deps.run ?? spawnHarness;

  return async (steamId: string, name: string, text: string) => {
    const settings = deps.settings();

    if (!Agent.mayUseAgent(settings, steamId)) return;

    const prompt = Agent.mention(settings, text);

    if (prompt === undefined) return;

    if (!queue.tryStart(steamId)) return deps.chat(`${name}: still working on your last request`);

    try {
      await deps.chat(`${name}: on it…`);
      await serial(() => job(steamId, name, prompt, settings));
    } catch (e) {
      console.error("agent run failed", e);
      await deps.chat(
        `${name}: agent unavailable (${e instanceof Error ? e.message : String(e)})`.slice(0, 120),
      );
    } finally {
      queue.finish(steamId);
    }
  };

  async function job(steamId: string, name: string, prompt: string, settings: Agent.Settings) {
    if (process.platform === "win32") await deps.prepareSandbox();

    const { kind, model } = deps.harness();
    const { token, revoke } = deps.issueRpcToken(steamId);
    const previous = deps.sessions.get(steamId);

    const argv = Harness.argv({
      kind,
      prompt: `[${name}] ${prompt}`,
      systemPrompt: Agent.systemPrompt(settings),
      model,
      session: previous,
    });

    const env = { BOT_RPC_URL: deps.rpcUrl(), BOT_RPC_TOKEN: token };

    const { stdout, exitCode } = await run(argv, env).finally(revoke);

    const reply = Harness.parse(kind, stdout, exitCode);

    if (reply.session !== undefined) deps.sessions.set(steamId, reply.session);

    const id = randomUUID().slice(0, 8);

    const body = reply.ok
      ? reply.text
      : `Something went wrong running ${kind}. Check the portal logs.`;

    deps.replies.set(id, body);

    const link = settings.portalUrl === undefined ? undefined : `${settings.portalUrl}/r/${id}`;

    for (const line of Agent.chatLines(body, link)) await deps.chat(line);
  }
};
