import { fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = () => ({ harness: bot().settings().harness });

// Local-only route (see hooks.server.ts): secrets are typed on the host PC and go straight into
// the sandbox distro; the bot never stores them.
export const actions = {
  default: async ({ request }) => {
    const f = await request.formData();
    const harness = String(f.get("harness") ?? "");
    const kind = String(f.get("kind") ?? "");
    const value = String(f.get("value") ?? "").trim();
    const envVar = String(f.get("envVar") ?? "").trim();

    if (value === "") return fail(400, { error: "Paste the token or key." });

    try {
      if (harness === "claude" && (kind === "oauthToken" || kind === "apiKey"))
        await bot().saveHarnessCredential({ harness, kind, value });
      else if (harness === "codex")
        await bot().saveHarnessCredential({ harness, kind: "apiKey", value });
      else if (harness === "pi") await bot().saveHarnessCredential({ harness, envVar, value });
      else return fail(400, { error: "Unknown harness." });
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : String(e) });
    }

    return { saved: harness };
  },
};
