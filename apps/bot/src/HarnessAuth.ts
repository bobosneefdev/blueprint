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

/** Provider keys Pi understands. An allowlist: NODE_OPTIONS / PATH / BASH_ENV would be code exec. */
export const PI_ENV_VARS = [
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
];

/** Real tokens and API keys are base64url-ish; anything else is rejected, not escaped. */
const SAFE_VALUE = /^[A-Za-z0-9._~+/=-]{8,512}$/;

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

/**
 * Env file sourced by the harness launch: `export NAME='value'` per line, agent-readable only.
 * NAME is from a fixed set and value matches SAFE_VALUE, so neither can carry shell syntax.
 */
const writeEnv = (name: string, value: string) =>
  asAgent(
    `umask 077; touch ~/.harness-env; grep -v '^export ${name}=' ~/.harness-env > ~/.harness-env.tmp; ` +
      `printf "export ${name}='%s'\\n" "$(cat)" >> ~/.harness-env.tmp; mv ~/.harness-env.tmp ~/.harness-env`,
    value,
  );

export const save = (c: Credential) => {
  if (!SAFE_VALUE.test(c.value)) throw new Error("that doesn't look like a token or API key");

  switch (c.harness) {
    case "claude":
      return writeEnv(
        c.kind === "oauthToken" ? "CLAUDE_CODE_OAUTH_TOKEN" : "ANTHROPIC_API_KEY",
        c.value,
      );
    case "codex":
      return asAgent("codex login --with-api-key", c.value);
    case "pi":
      if (!PI_ENV_VARS.includes(c.envVar)) throw new Error("unsupported provider");

      return writeEnv(c.envVar, c.value);
  }
};

/**
 * Prefix for every harness run so the stored credentials are in the environment. A bare
 * `. missing-file` exits POSIX sh even with 2>/dev/null, so the file is tested first.
 */
export const ENV_PRELUDE = "[ -f ~/.harness-env ] && . ~/.harness-env;";
