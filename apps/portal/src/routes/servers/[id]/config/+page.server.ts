import { error, fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

const SID64 = /^7656119\d{10}$/;

export const load = ({ params, locals }) => {
  const b = bot();
  const s = b.servers().find((x) => x.id === params.id);
  const roles = b.settings().roles[params.id] ?? {};
  const host = b.hostSteamId();
  // Live team, plus anyone already given a role who isn't in it right now.
  const team = new Map((s?.world?.team ?? []).map((m) => [m.steamId, m.name]));

  for (const sid of Object.keys(roles)) if (!team.has(sid)) team.set(sid, sid);

  return {
    botName: b.settings().botName,
    isHost: locals.sid64 === host,
    connected: s?.world !== undefined,
    members: [...team].flatMap(([steamId, name]) =>
      steamId === host ? [] : [{ steamId, name, role: roles[steamId] ?? "none" }],
    ),
  };
};

export const actions = {
  default: async ({ request, params, locals }) => {
    const b = bot();

    if (locals.sid64 !== b.hostSteamId()) error(403, "Only the host can change roles.");

    if (!b.servers().some((s) => s.id === params.id)) error(404);

    // Fields are "role:<sid64>" = none | interact | admin.
    const roles: Record<string, "interact" | "admin"> = {};

    for (const [k, v] of await request.formData()) {
      const sid = /^role:(\d+)$/.exec(k)?.[1];

      if (sid === undefined) continue;

      if (!SID64.test(sid)) return fail(400, { error: "Unknown player." });

      if (v === "interact" || v === "admin") roles[sid] = v;
      else if (v !== "none") return fail(400, { error: "Unknown role." });
    }

    const settings = b.settings();

    await b.saveSettings({ ...settings, roles: { ...settings.roles, [params.id]: roles } });

    return { saved: true };
  },
};
