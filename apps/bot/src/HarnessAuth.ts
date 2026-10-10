// Harness credentials live only inside the sandbox distro (agent's home), never in the bot's
// config. The portal collects them once on the host PC and hands them over here.
//
//   claude  long-lived token from `claude setup-token` (subscription) or an Anthropic API key
//   codex   OpenAI API key (ChatGPT-plan device sign-in: not yet)
//   pi      provider API key (env var per provider)
import * as Sandbox from "./Sandbox.ts";

export type Credential =
  | { readonly harness: "claude"; readonly kind: "oauthToken" | "apiKey"; readonly value: string }
  | { readonly harness: "codex"; readonly kind: "apiKey"; readonly value: string }
  | { readonly harness: "pi"; readonly envVar: string; readonly value: string };

const ENV_VAR = /^[A-Z][A-Z0-9_]{2,40}$/;

/** Shell-free: the secret goes over stdin, never argv (argv is visible to other processes). */
const asAgent = (script: string, stdin: string) => {
  const r = Bun.spawnSync(
    [
      "wsl.exe",
      "-d",
      Sandbox.DISTRO,
      "-u",
      "agent",
      "--cd",
      "/home/agent",
      "--",
      "sh",
      "-c",
      script,
    ],
    { stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" },
  );

  if (r.exitCode !== 0) throw new Error(r.stderr.toString().trim() || `exit ${r.exitCode}`);

  return r.stdout.toString();
};

/** Env file sourced by the harness launch; one `export K=V` per line, agent-readable only. */
const writeEnv = (name: string, value: string) =>
  asAgent(
    `umask 077; touch ~/.harness-env; grep -v '^export ${name}=' ~/.harness-env > ~/.harness-env.tmp; ` +
      `printf 'export ${name}=%s\\n' "$(cat)" >> ~/.harness-env.tmp; mv ~/.harness-env.tmp ~/.harness-env`,
    value,
  );

export const save = (c: Credential) => {
  if (/[\r\n'"$`\\]/.test(c.value)) throw new Error("credential contains invalid characters");

  switch (c.harness) {
    case "claude":
      return writeEnv(
        c.kind === "oauthToken" ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY",
        c.value,
      );
    case "codex":
      return asAgent("codex login --with-api-key", c.value);
    case "pi":
      if (!ENV_VAR.test(c.envVar)) throw new Error("invalid provider variable");

      return writeEnv(c.envVar, c.value);
  }
};

/** Prefix for every harness run so the stored credentials are in the environment. */
export const ENV_PRELUDE = ". ~/.harness-env 2>/dev/null;";
