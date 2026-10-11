// Install-local configuration under %LOCALAPPDATA%\blueprint (or $XDG_DATA_HOME on dev boxes).
// Secrets (Rust+ auth token, FCM credentials, session secret) live here, never in the workspace.
import type { Agent } from "@blueprint/core";
import { Schema } from "effect";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const dataDir = () =>
  process.env.BLUEPRINT_HOME ??
  (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "blueprint")
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "blueprint"));

const Harness = Schema.Literals(["claude", "codex", "pi"]);

export const Config = Schema.Struct({
  botName: Schema.String,
  hostSteamId: Schema.String,
  /** Pre-roles installs; migrated into `roles` (as admin on every server) at startup. */
  allowlist: Schema.optionalKey(Schema.Array(Schema.String)),
  /** serverId -> SID64 -> role. The host is admin everywhere and never listed. */
  roles: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Record(Schema.String, Schema.Literals(["interact", "admin"])),
    ),
  ),
  harness: Harness,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.String),
  fast: Schema.optionalKey(Schema.Boolean),
  portalPort: Schema.Number,
  rpcPort: Schema.Number,
  sessionSecret: Schema.String,
  ntfyTopic: Schema.optionalKey(Schema.String),
  discordWebhook: Schema.optionalKey(Schema.String),
  /** Set by the pairing flow. */
  rustplus: Schema.optionalKey(
    Schema.Struct({
      authToken: Schema.String,
      expoPushToken: Schema.String,
      fcm: Schema.Struct({ androidId: Schema.String, securityToken: Schema.String }),
      persistentIds: Schema.Array(Schema.String),
    }),
  ),
});

export interface Config extends Schema.Schema.Type<typeof Config> {}

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Config));

const defaults = (): Config => ({
  botName: "bot",
  hostSteamId: "",
  harness: "claude",
  portalPort: 47614,
  rpcPort: 47615,
  sessionSecret: randomBytes(32).toString("base64url"),
});

const path = () => join(dataDir(), "config.json");

export const load = async (): Promise<Config> => {
  mkdirSync(dataDir(), { recursive: true });

  const f = Bun.file(path());

  if (!(await f.exists())) {
    const c = defaults();

    await save(c);

    return c;
  }

  return decode(await f.text());
};

/** Applies portal settings; optional keys are dropped when blank. Validated by the schema. */
export const merge = (
  c: Config,
  next: {
    readonly botName: string;
    readonly roles: Agent.Roles;
    readonly harness: Config["harness"];
    readonly model: string | undefined;
    readonly effort: string | undefined;
    readonly fast: boolean;
    readonly ntfyTopic: string | undefined;
    readonly discordWebhook: string | undefined;
  },
): Config => {
  const {
    model: _m,
    effort: _e,
    fast: _f,
    ntfyTopic: _n,
    discordWebhook: _d,
    allowlist: _a,
    ...base
  } = c;

  const out: Record<string, Schema.Json> = JSON.parse(JSON.stringify(base));

  out.botName = next.botName;
  out.roles = JSON.parse(JSON.stringify(next.roles));
  out.harness = next.harness;

  if (next.model) out.model = next.model;

  if (next.effort) out.effort = next.effort;

  if (next.fast) out.fast = true;

  if (next.ntfyTopic) out.ntfyTopic = next.ntfyTopic;

  if (next.discordWebhook) out.discordWebhook = next.discordWebhook;

  return decode(JSON.stringify(out));
};

export const withoutRustPlus = (c: Config): Config => {
  const { rustplus: _r, ...rest } = c;

  return rest;
};

/** Old allowlisted players could confirm plugins, so they keep that as admin on every server. */
export const migrateAllowlist = (c: Config, serverIds: ReadonlyArray<string>): Config => {
  const { allowlist, ...rest } = c;

  if (allowlist === undefined) return c;

  const roles: Record<string, Record<string, "interact" | "admin">> = JSON.parse(
    JSON.stringify(c.roles ?? {}),
  );

  for (const id of serverIds)
    for (const sid of allowlist) roles[id] = { ...roles[id], [sid]: roles[id]?.[sid] ?? "admin" };

  return { ...rest, roles };
};

export const save = (c: Config) => Bun.write(path(), `${JSON.stringify(c, null, 2)}\n`);
