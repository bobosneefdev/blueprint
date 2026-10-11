import { error, fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

const SID64 = /^7656119\d{10}$/;

/** Teammates per server (live team, plus anyone already given a role who isn't online in it). */
const teams = () => {
  const roles = bot().settings().roles;
  const host = bot().hostSteamId();

  return bot()
    .servers()
    .map((s) => {
      const team = new Map((s.world?.team ?? []).map((m) => [m.steamId, m.name]));

      for (const sid of Object.keys(roles[s.id] ?? {})) if (!team.has(sid)) team.set(sid, sid);

      return {
        id: s.id,
        name: s.name,
        connected: s.world !== undefined,
        members: [...team].flatMap(([steamId, name]) =>
          steamId === host ? [] : [{ steamId, name, role: roles[s.id]?.[steamId] ?? "none" }],
        ),
      };
    });
};

export const load = ({ locals }) => ({
  settings: bot().settings(),
  teams: teams(),
  isHost: locals.sid64 === bot().hostSteamId(),
  role: locals.role,
  local: locals.local,
  // Streamed: the live model list comes from the harness CLI in the sandbox.
  harnesses: bot().harnesses(),
});

export const actions = {
  save: async ({ request, locals }) => {
    if (locals.sid64 !== bot().hostSteamId()) error(403, "Only the host can change settings.");

    const f = await request.formData();
    const botName = String(f.get("botName") ?? "").trim();
    const harness = String(f.get("harness") ?? "");

    // Fields are "role:<serverId>:<sid64>" = none | interact | admin.
    const roles: Record<string, Record<string, "interact" | "admin">> = {};

    const serverIds = new Set(
      bot()
        .servers()
        .map((s) => s.id),
    );

    for (const [k, v] of f) {
      const m = /^role:([^:]+):(\d+)$/.exec(k);

      if (!m?.[1] || !m[2]) continue;

      if (!serverIds.has(m[1]) || !SID64.test(m[2]))
        return fail(400, { error: "Unknown server or player in roles." });

      if (v === "interact" || v === "admin") roles[m[1]] = { ...roles[m[1]], [m[2]]: v };
      else if (v !== "none") return fail(400, { error: "Unknown role." });
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,15}$/.test(botName))
      return fail(400, { error: "Bot name: letters, numbers, . _ - (max 16)." });

    if (harness !== "claude" && harness !== "codex" && harness !== "pi")
      return fail(400, { error: "Pick a harness." });

    const model = String(f.get("model") ?? "").trim() || undefined;
    const effort = String(f.get("effort") ?? "").trim() || undefined;

    // Both reach the harness's argv; the pickers offer the CLI's own ids, but forms can be forged.
    if (model !== undefined && !/^[\w.:/[\]-]{1,100}$/.test(model))
      return fail(400, {
        error: "That model id has characters no model uses.",
      });

    if (effort !== undefined && !/^[a-z]{1,16}$/.test(effort))
      return fail(400, { error: "Unknown reasoning level." });

    const discordWebhook = String(f.get("discordWebhook") ?? "").trim() || undefined;

    if (
      discordWebhook !== undefined &&
      !/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(
        discordWebhook,
      )
    )
      return fail(400, {
        error: "Discord webhook: paste the URL from Server Settings → Integrations → Webhooks.",
      });

    await bot().saveSettings({
      botName,
      harness,
      roles,
      model,
      effort,
      fast: f.get("fast") === "on",
      ntfyTopic: String(f.get("ntfyTopic") ?? "").trim() || undefined,
      discordWebhook,
    });

    return { saved: true };
  },
  import: async ({ request, locals }) => {
    if (locals.role !== "admin" || locals.sid64 === undefined)
      error(403, "Only the host or an admin can import plugins.");

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
