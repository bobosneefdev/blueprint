import { error, fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

const SID64 = /^7656119\d{10}$/;

export const load = ({ locals }) => ({
  settings: bot().settings(),
  isHost: locals.sid64 === bot().hostSteamId,
});

export const actions = {
  save: async ({ request, locals }) => {
    if (locals.sid64 !== bot().hostSteamId) error(403, "Only the host can change settings.");

    const f = await request.formData();
    const botName = String(f.get("botName") ?? "").trim();
    const harness = String(f.get("harness") ?? "");

    const allowlist = String(f.get("allowlist") ?? "")
      .split(/[\s,]+/)
      .filter((s) => s !== "");

    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,15}$/.test(botName))
      return fail(400, { error: "Bot name: letters, numbers, . _ - (max 16)." });

    if (harness !== "claude" && harness !== "codex" && harness !== "pi")
      return fail(400, { error: "Pick a harness." });

    const bad = allowlist.find((s) => !SID64.test(s));

    if (bad !== undefined) return fail(400, { error: `Not a SteamID64: ${bad}` });

    await bot().saveSettings({
      botName,
      harness,
      allowlist,
      model: String(f.get("model") ?? "").trim() || undefined,
      ntfyTopic: String(f.get("ntfyTopic") ?? "").trim() || undefined,
    });

    return { saved: true };
  },
  import: async ({ request, locals }) => {
    if (locals.sid64 !== bot().hostSteamId) error(403, "Only the host can import plugins.");

    const url = String((await request.formData()).get("url") ?? "").trim();

    if (!url.startsWith("https://raw.githubusercontent.com/"))
      return fail(400, {
        importError: "Use a raw.githubusercontent.com plugin URL from the gallery.",
      });

    const problems = await bot().importPlugin(url, locals.sid64);

    return problems.length > 0
      ? fail(422, { importError: problems.join("; ") })
      : { imported: true };
  },
};
