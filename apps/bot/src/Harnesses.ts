// What the portal shows about each AI harness inside the sandbox: installed version against the
// approved range, sign-in state, and the live model list (with reasoning levels and fast mode)
// straight from the CLI. Install/upgrade and sign-in also run here, all as the `agent` user.
//
// Every probe is non-interactive (verified against claude 2.1.296, codex-cli 0.162.1, pi 1.1.0):
//   claude  `claude auth status` exit code; models from the stream-json `initialize` control
//           request (value, displayName, supportedEffortLevels, supportsFastMode)
//   codex   `codex app-server` JSON-RPC: initialize -> account/read, model/list
//   pi      `pi --mode rpc` {"type":"get_available_models"}; signed in iff any model is listed
//   sign-in codex: `codex login --device-auth` (code shown in the portal, user approves on
//           openai.com). claude: `claude setup-token` under a pty; the user pastes back the code.
import type { Harness } from "@blueprint/core";
import { stripANSI } from "bun";
import { Option, Schema } from "effect";
import * as HarnessAuth from "./HarnessAuth.ts";
import versions from "../../../packages/installer/rootfs/harness-versions.json";
import * as Sandbox from "./Sandbox.ts";

export type Kind = Harness.Kind;

/**
 * Versions Blueprint is tested against, shared with the rootfs build: `min` is the oldest that
 * works with our flags and JSON parsing; `pin` is what install/upgrade/downgrade puts in. Bump
 * `pin` only after verifying a release.
 */
export const APPROVED: Record<
  Kind,
  { readonly package: string; readonly min: string; readonly pin: string }
> = versions;

export interface Model {
  readonly id: string;
  readonly label: string;
  readonly efforts: ReadonlyArray<string>;
  readonly defaultEffort: string | undefined;
  readonly fast: boolean;
  readonly isDefault: boolean;
}

export interface Status {
  readonly kind: Kind;
  readonly version: string | undefined;
  /** missing: not installed. outdated/ahead: outside the approved range. */
  readonly approved: {
    readonly package: string;
    readonly min: string;
    readonly pin: string;
  };
  readonly state: "missing" | "outdated" | "ahead" | "ok";
  readonly signedIn: boolean;
  readonly models: ReadonlyArray<Model>;
}

const inSandbox = (script: string, user = "agent") =>
  process.platform === "win32"
    ? ["wsl.exe", "-d", Sandbox.DISTRO, "-u", user, "--cd", "/home/agent", "--", "sh", "-c", script]
    : ["sh", "-c", script];

/**
 * Runs a shell snippet in the sandbox as `agent`, with stored credentials and user-installed
 * harnesses on PATH. With `until`, stdin stays open and the process is stopped once stdout
 * satisfies it (codex app-server exits at stdin EOF before it answers).
 */
const sh = async (
  script: string,
  {
    stdin = "",
    timeoutMs = 30_000,
    until,
    user,
  }: {
    stdin?: string;
    timeoutMs?: number;
    until?: (out: string) => boolean;
    user?: "root";
  } = {},
) => {
  const p = Bun.spawn(inSandbox(`${HarnessAuth.ENV_PRELUDE} ${script}`, user), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });

  p.stdin.write(stdin);
  await p.stdin.flush();

  if (until === undefined) await p.stdin.end();

  const timer = setTimeout(() => p.kill(), timeoutMs);
  let out = "";

  try {
    for await (const chunk of p.stdout) {
      out += new TextDecoder().decode(chunk);

      if (until?.(out)) {
        p.kill();
        break;
      }
    }

    return { out, code: until === undefined ? await p.exited : 0 };
  } finally {
    clearTimeout(timer);
  }
};

const VERSION = /\bv?(\d+\.\d+\.\d+)\b/;

export const rangeState = (kind: Kind, version: string | undefined): Status["state"] => {
  if (version === undefined) return "missing";

  const { min, pin } = APPROVED[kind];

  if (Bun.semver.order(version, min) < 0) return "outdated";

  return Bun.semver.order(version, pin) > 0 ? "ahead" : "ok";
};

// Only the fields we read from each CLI's JSON; anything else is ignored.
const ClaudeInit = Schema.Struct({
  type: Schema.Literal("control_response"),
  response: Schema.Struct({
    response: Schema.Struct({
      models: Schema.Array(
        Schema.Struct({
          value: Schema.String,
          displayName: Schema.optionalKey(Schema.String),
          supportedEffortLevels: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
          supportsFastMode: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
        }),
      ),
    }),
  }),
});

const CodexAccount = Schema.Struct({
  id: Schema.Literal(2),
  result: Schema.Struct({
    account: Schema.optionalKey(Schema.NullOr(Schema.Struct({ type: Schema.String }))),
    requiresOpenaiAuth: Schema.optionalKey(Schema.Boolean),
  }),
});

const CodexModels = Schema.Struct({
  id: Schema.Literal(3),
  result: Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        model: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
        hidden: Schema.optionalKey(Schema.Boolean),
        isDefault: Schema.optionalKey(Schema.Boolean),
        defaultReasoningEffort: Schema.optionalKey(Schema.NullOr(Schema.String)),
        supportedReasoningEfforts: Schema.optionalKey(
          Schema.Array(Schema.Struct({ reasoningEffort: Schema.String })),
        ),
        additionalSpeedTiers: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
      }),
    ),
  }),
});

const PiModels = Schema.Struct({
  command: Schema.Literal("get_available_models"),
  data: Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        provider: Schema.String,
        id: Schema.String,
        name: Schema.optionalKey(Schema.String),
        reasoning: Schema.optionalKey(Schema.Boolean),
        thinkingLevelMap: Schema.optionalKey(
          Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
        ),
      }),
    ),
  }),
});

/** First JSONL line that decodes as `schema`; banners and other events are skipped. */
const firstLine = <T, E>(schema: Schema.Codec<T, E>, out: string): T | undefined => {
  const decode = Schema.decodeUnknownOption(Schema.fromJsonString(schema));

  for (const line of out.split("\n")) {
    const r = decode(line.trim());

    if (Option.isSome(r)) return r.value;
  }

  return undefined;
};

/** `initialize` control response from Claude Code's stream-json mode. */
export const claudeModels = (out: string): Model[] =>
  (firstLine(ClaudeInit, out)?.response.response.models ?? []).map((m) => ({
    id: m.value,
    label: m.displayName ?? m.value,
    efforts: m.supportedEffortLevels ?? [],
    defaultEffort: undefined,
    fast: m.supportsFastMode === true,
    isDefault: m.value === "default",
  }));

/** codex app-server: `model/list` result.data */
export const codexModels = (out: string): Model[] =>
  (firstLine(CodexModels, out)?.result.data ?? [])
    .filter((m) => m.hidden !== true)
    .map((m) => ({
      id: m.model,
      label: m.displayName ?? m.model,
      efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
      defaultEffort: m.defaultReasoningEffort ?? undefined,
      fast: (m.additionalSpeedTiers ?? []).includes("fast"),
      isDefault: m.isDefault === true,
    }));

export const codexSignedIn = (out: string) => {
  const r = firstLine(CodexAccount, out)?.result;

  return r !== undefined && (r.account != null || r.requiresOpenaiAuth === false);
};

const PI_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** pi --mode rpc: get_available_models. A level is offered unless its map entry is null. */
export const piModels = (out: string): Model[] =>
  (firstLine(PiModels, out)?.data.models ?? []).map((m) => {
    const map = m.thinkingLevelMap ?? {};
    const id = `${m.provider}/${m.id}`;

    // xhigh/max need an explicit mapping; the rest are on unless mapped to null.
    const offered = (l: string) =>
      l === "xhigh" || l === "max" ? Boolean(map[l]) : map[l] !== null;

    return {
      id,
      label: `${m.name ?? id} (${m.provider})`,
      efforts: m.reasoning === true ? PI_LEVELS.filter(offered) : [],
      defaultEffort: undefined,
      fast: false,
      isDefault: false,
    };
  });

const CLAUDE_INIT = `{"type":"control_request","request_id":"1","request":{"subtype":"initialize"}}`;

const CODEX_RPC = [
  `{"id":1,"method":"initialize","params":{"clientInfo":{"name":"blueprint","title":"Blueprint","version":"1"}}}`,
  `{"method":"initialized"}`,
  `{"id":2,"method":"account/read","params":{}}`,
  `{"id":3,"method":"model/list","params":{}}`,
].join("\n");

const probe = async (kind: Kind): Promise<Status> => ({
  ...(await probeCli(kind)),
  approved: APPROVED[kind],
});

const probeCli = async (kind: Kind): Promise<Omit<Status, "approved">> => {
  const v = await sh(`${kind} --version 2>&1`, { timeoutMs: 15_000 });
  const version = v.code === 0 ? VERSION.exec(v.out)?.[1] : undefined;
  const state = rangeState(kind, version);

  if (version === undefined) return { kind, version, state, signedIn: false, models: [] };

  switch (kind) {
    case "claude": {
      const [auth, init] = await Promise.all([
        sh("claude auth status >/dev/null 2>&1"),
        sh("claude -p --input-format stream-json --output-format stream-json --verbose", {
          stdin: `${CLAUDE_INIT}\n`,
        }),
      ]);

      return {
        kind,
        version,
        state,
        signedIn: auth.code === 0,
        models: claudeModels(init.out),
      };
    }

    case "codex": {
      const r = await sh("codex app-server", {
        stdin: `${CODEX_RPC}\n`,
        // Replies can arrive in either order; wait for both complete lines.
        until: (out) => /\{"id":2,.*\n/.test(out) && /\{"id":3,.*\n/.test(out),
      });

      return {
        kind,
        version,
        state,
        signedIn: codexSignedIn(r.out),
        models: codexModels(r.out),
      };
    }

    case "pi": {
      const r = await sh("pi --mode rpc --no-session", {
        stdin: `{"type":"get_available_models"}\n`,
        until: (out) => out.includes("get_available_models"),
      });

      const models = piModels(r.out);

      return { kind, version, state, signedIn: models.length > 0, models };
    }
  }
};

// Each probe starts several sandbox processes; page loads within a few seconds share one result.
let cached: { readonly at: number; readonly result: Promise<Status[]> } | undefined;

export const status = () => {
  if (cached === undefined || Date.now() - cached.at > 20_000)
    cached = {
      at: Date.now(),
      result: Promise.all((["claude", "codex", "pi"] as const).map(probe)),
    };

  return cached.result;
};

/** Install, sign-in and saved keys change what status reports. */
export const stale = () => {
  cached = undefined;
};

let synced = false;

/** Windows: import the sandbox on first use and bring an older one up to date (once per run). */
export const ready = async (home: string) => {
  if (process.platform !== "win32") return;

  await Sandbox.ensure(home);

  if (!synced) Sandbox.syncSystem();

  synced = true;
};

/**
 * Installs, upgrades or downgrades to the approved pin. Runs as root: the agent user's firewall
 * blocks the npm registry, and the harness lives in the global prefix the rootfs installed into.
 */
export const install = async (kind: Kind) => {
  if (process.platform !== "win32") throw new Error("installs only run in the Windows sandbox");

  const r = await sh(
    `npm install -g --no-fund --no-audit ${APPROVED[kind].package}@${APPROVED[kind].pin} 2>&1`,
    { timeoutMs: 10 * 60_000, user: "root" },
  );

  stale();

  if (r.code !== 0) throw new Error(r.out.trim().split("\n").slice(-3).join(" "));
};

// ── Interactive sign-in ─────────────────────────────────────────────────────────────────────────
// One login at a time; the portal polls `login()` for the URL/code and the outcome.

export interface Login {
  readonly kind: Kind;
  readonly url: string | undefined;
  /** codex device code to type on openai.com; claude has none (the user pastes one back). */
  readonly code: string | undefined;
  readonly state: "starting" | "waiting" | "done" | "failed";
  readonly message: string | undefined;
}

let current: (Login & { readonly answer?: (code: string) => void }) | undefined;

/** Without `answer`: this goes into page data, and functions can't be serialized. */
export const login = (): Login | undefined => {
  if (current === undefined) return undefined;

  const { answer: _, ...l } = current;

  return l;
};

const set = (patch: Partial<Login>) => {
  if (current) current = { ...current, ...patch };
};

const URL_RE = /https:\/\/\S+/;

const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;

/** Starts a sign-in and returns once the URL is known (or it failed). */
export const startLogin = async (kind: "claude" | "codex") => {
  current = {
    kind,
    url: undefined,
    code: undefined,
    state: "starting",
    message: undefined,
  };

  // claude setup-token needs a tty: `script` gives it one. It prints a long-lived token that we
  // store like a pasted one; codex writes its own ~/.codex/auth.json.
  const cmd =
    kind === "codex"
      ? "codex login --device-auth 2>&1"
      : "script -qfec 'claude setup-token' /dev/null";

  const p = Bun.spawn(inSandbox(`${HarnessAuth.ENV_PRELUDE} ${cmd}`), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => p.kill(), 15 * 60_000);
  let text = "";

  current = {
    ...current,
    answer: (code) => {
      p.stdin.write(`${code}\r`);
      void p.stdin.flush();
    },
  };

  const read = (async () => {
    for await (const chunk of p.stdout) {
      // Terminal output wraps the URL; join lines before matching.
      text += stripANSI(new TextDecoder().decode(chunk)).replace(/\r?\n(?=\S)/g, "");

      if (current?.url === undefined) {
        const url = URL_RE.exec(text)?.[0];
        const code = DEVICE_CODE.exec(text)?.[0];

        if (url !== undefined && (kind === "claude" || code !== undefined))
          set({ url, code, state: "waiting" });
      }

      // claude setup-token stays open on a bad code ("Press Enter to retry"); end it instead.
      if (text.includes("OAuth error")) {
        set({
          state: "failed",
          message: "Claude rejected that code. Start again and paste the new one.",
        });
        p.kill();
      }
    }
  })();

  void Promise.all([read, p.exited]).then(async ([, exit]) => {
    clearTimeout(timer);
    stale();

    const token = /sk-ant-oat\S+/.exec(text)?.[0];

    if (kind === "claude" && token !== undefined) {
      HarnessAuth.save({ harness: "claude", kind: "oauthToken", value: token });

      return set({ state: "done", message: undefined });
    }

    if (kind === "codex" && exit === 0) return set({ state: "done", message: undefined });

    if (current?.state === "failed") return;

    const why = /(error|failed)[^\n]*/i.exec(text)?.[0];

    set({ state: "failed", message: why ?? `sign-in ended (exit ${exit})` });
  });

  for (let i = 0; i < 60 && current?.state === "starting"; i++) await Bun.sleep(250);
};

/** Claude only: the code shown on claude.com after approving. */
export const answerLogin = (code: string) => {
  if (!/^[A-Za-z0-9_#-]{8,256}$/.test(code)) throw new Error("that doesn't look like the code");

  current?.answer?.(code);
};
