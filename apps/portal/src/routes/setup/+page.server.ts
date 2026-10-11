// First-run wizard (host PC only, see hooks.server.ts): Rust+ sign-in, then an AI harness, then
// pairing a server in game. Each step can be revisited later from Settings.
import { fail } from "@sveltejs/kit";
import { bot, type HarnessKind } from "#lib/server/bot.ts";
import * as Session from "#lib/server/session.ts";

const KINDS: ReadonlyArray<HarnessKind> = ["claude", "codex", "pi"];

const kindOf = (f: FormData) => KINDS.find((k) => k === f.get("kind"));

/** Runs a bot call; its Error message (written for players) becomes the form error. */
const attempt = async <A>(status: number, run: () => Promise<A>, prefix = "") => {
  try {
    return await run();
  } catch (e) {
    return fail(status, {
      error: prefix + String(e instanceof Error ? e.message : e),
    });
  }
};

export const load = async () => {
  const b = bot();

  return {
    pairing: b.pairing(),
    servers: b.servers().length,
    settings: b.settings(),
    login: b.harnessLogin(),
    // Streamed: probing the sandbox takes a few seconds (minutes on the very first import).
    harnesses: b.harnesses(),
  };
};

const COOKIE = {
  path: "/",
  httpOnly: true,
  secure: false,
  sameSite: "lax",
  maxAge: 7 * 86400,
} as const;

export const actions = {
  // Rust+ sign-in. The same Steam account becomes host and is signed in to this portal, so the
  // host doesn't sign in twice on first run.
  pair: ({ cookies }) =>
    attempt(500, async () => {
      const b = bot();
      const sid64 = await b.pair();

      if (sid64 === b.hostSteamId())
        cookies.set("session", Session.issue(b.sessionSecret, sid64), COOKIE);

      return { paired: true };
    }),

  install: async ({ request }) => {
    const kind = kindOf(await request.formData());

    if (kind === undefined) return fail(400, { error: "Unknown AI." });

    return attempt(
      500,
      async () => {
        await bot().installHarness(kind);

        return { installed: kind };
      },
      "Install failed: ",
    );
  },

  login: async ({ request }) => {
    const kind = kindOf(await request.formData());

    if (kind !== "claude" && kind !== "codex") return fail(400, { error: "Unknown AI." });

    return attempt(500, async () => {
      await bot().startHarnessLogin(kind);

      return { loginStarted: kind };
    });
  },

  code: async ({ request }) => {
    const code = String((await request.formData()).get("code") ?? "").trim();

    return attempt(400, async () => {
      bot().answerHarnessLogin(code);

      return { codeSent: true };
    });
  },

  // Fallback for API keys and Pi providers. Secrets go straight into the sandbox.
  key: async ({ request }) => {
    const f = await request.formData();
    const kind = kindOf(f);
    const value = String(f.get("value") ?? "").trim();

    if (kind === undefined) return fail(400, { error: "Unknown AI." });

    if (value === "") return fail(400, { error: "Paste the key." });

    return attempt(400, async () => {
      await bot().saveHarnessCredential(
        kind === "pi"
          ? { harness: kind, envVar: String(f.get("envVar") ?? ""), value }
          : { harness: kind, kind: "apiKey", value },
      );

      return { keySaved: kind };
    });
  },

  choose: async ({ request }) => {
    const f = await request.formData();
    const kind = kindOf(f);

    if (kind === undefined) return fail(400, { error: "Unknown AI." });

    const s = bot().settings();

    await bot().saveSettings({
      ...s,
      harness: kind,
      model: undefined,
      effort: undefined,
      fast: false,
    });

    return { chosen: kind };
  },
};
