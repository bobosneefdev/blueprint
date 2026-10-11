// The plugin workspace: a git repo owned by the bot. The agent never sees it: the agent drafts in a
// separate share and plugins enter here only via propose -> validate -> requester confirms.
//   plugins/<name>.json         active plugin logic
//   servers/<id>/bindings.json  entity ids per server (reset on wipe)
//   enabled.json                { "<name>": true|false }
// Every activation/toggle/rollback is a commit, so history and undo come from git.
import { Validate, type Plugin } from "@blueprint/dsl";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Repo config can never run code: no hooks, no fsmonitor, no external diff/textconv. */
const HARDEN = [
  "-c",
  `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "protocol.allow=never",
];

const git = (dir: string, ...args: string[]) => {
  // Packaged builds ship MinGit (many gamers have no git); BLUEPRINT_GIT points at it.
  const r = Bun.spawnSync([process.env.BLUEPRINT_GIT ?? "git", ...HARDEN, "-C", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (r.exitCode !== 0) throw new Error(`git ${args[0]}: ${r.stderr.toString().trim()}`);

  return r.stdout.toString();
};

/** Creates the repo on first run, seeded with `starters` (already validated plugins). */
export const init = async (dir: string, starters: ReadonlyArray<Plugin> = []) => {
  mkdirSync(join(dir, "plugins"), { recursive: true });
  mkdirSync(join(dir, "servers"), { recursive: true });

  if (readdirSync(dir).includes(".git")) return;

  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "blueprint");
  git(dir, "config", "user.email", "bot@blueprint.local");

  // Plugins needing a smart device start disabled; the rest work out of the box.
  const enabled = Object.fromEntries(starters.map((p) => [p.name, p.bindings.length === 0]));

  for (const p of starters)
    await Bun.write(join(dir, "plugins", `${p.name}.json`), `${JSON.stringify(p, null, 2)}\n`);

  await writeEnabled(dir, enabled);
  commitAll(dir, "starter plugins");
};

const enabledPath = (dir: string) => join(dir, "enabled.json");

const readEnabled = async (dir: string): Promise<Record<string, boolean>> => {
  const f = Bun.file(enabledPath(dir));

  return (await f.exists()) ? f.json() : {};
};

export interface Loaded {
  readonly plugin: Plugin;
  readonly enabled: boolean;
}

export interface Invalid {
  readonly file: string;
  readonly problems: ReadonlyArray<Validate.Problem>;
}

/** Loads every plugin that validates. Invalid files are reported, never activated. */
export const load = async (dir: string) => {
  const enabled = await readEnabled(dir);
  const loaded: Loaded[] = [];
  const invalid: Invalid[] = [];

  for (const file of readdirSync(join(dir, "plugins"))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const r = Validate.validate(await Bun.file(join(dir, "plugins", file)).json());

    // Unknown plugins stay off: only activate()/setEnabled() turn things on.
    if (r.ok) loaded.push({ plugin: r.plugin, enabled: enabled[r.plugin.name] ?? false });
    else invalid.push({ file, problems: r.problems });
  }

  return { loaded, invalid };
};

export const commit = (dir: string, message: string) => commitAll(dir, message);

const commitAll = (dir: string, message: string) => {
  git(dir, "add", "-A");

  if (git(dir, "status", "--porcelain").trim() !== "") git(dir, "commit", "-q", "-m", message);
};

/** Writes, enables and commits a validated plugin. Returns the commit hash. */
export const activate = async (dir: string, plugin: Plugin, by: string) => {
  await Bun.write(
    join(dir, "plugins", `${plugin.name}.json`),
    `${JSON.stringify(plugin, null, 2)}\n`,
  );
  await writeEnabled(dir, { ...(await readEnabled(dir)), [plugin.name]: true });
  commitAll(dir, `activate ${plugin.name} v${plugin.version} (by ${by})`);

  return git(dir, "rev-parse", "HEAD").trim();
};

const writeEnabled = (dir: string, enabled: Record<string, boolean>) =>
  Bun.write(enabledPath(dir), `${JSON.stringify(enabled, null, 2)}\n`);

export const setEnabled = async (dir: string, name: string, on: boolean, by: string) => {
  assertName(name);
  await writeEnabled(dir, { ...(await readEnabled(dir)), [name]: on });
  commitAll(dir, `${on ? "enable" : "disable"} ${name} (by ${by})`);
};

export interface Commit {
  readonly commit: string;
  readonly at: string;
  readonly message: string;
}

const COMMIT = /^[0-9a-f]{7,40}$/;

const NAME = /^[a-z][a-z0-9-]{1,31}$/;

/** Plugin names reach git pathspecs; only DSL-valid names are allowed. */
const assertName = (name: string) => {
  if (!NAME.test(name)) throw new Error("bad plugin name");
};

/** Unified diff of one plugin file introduced by `commit`. */
export const diff = (dir: string, name: string, commit: string) => {
  assertName(name);

  if (!COMMIT.test(commit)) throw new Error("bad commit");

  return git(dir, "show", "--format=", "--no-color", commit, "--", `plugins/${name}.json`);
};

export const history = (dir: string, name: string): Commit[] =>
  NAME.test(name) ? historyOf(dir, name) : [];

const historyOf = (dir: string, name: string): Commit[] =>
  git(dir, "log", "--format=%H%x09%cI%x09%s", "--", `plugins/${name}.json`)
    .split("\n")
    .flatMap((line) => {
      const [commit, at, message] = line.split("\t");

      return commit && at && message ? [{ commit, at, message }] : [];
    });

/** Restores one plugin file to its state at `commit`, as a new commit (history is never rewritten). */
export const rollback = (dir: string, name: string, commit: string, by: string) => {
  assertName(name);

  if (!COMMIT.test(commit)) throw new Error("bad commit");

  git(dir, "checkout", commit, "--", `plugins/${name}.json`);
  commitAll(dir, `restore ${name} to ${commit.slice(0, 7)} (by ${by})`);
};

/** `@bot undo`: revert the most recent commit that touched plugins/. */
export const undoLast = (dir: string, by: string) => {
  const last = git(dir, "log", "-1", "--format=%H", "--", "plugins/").trim();

  if (last === "") return undefined;

  git(dir, "revert", "--no-edit", last);
  git(dir, "commit", "--amend", "-q", "-m", `undo ${last.slice(0, 7)} (by ${by})`);

  return last;
};
