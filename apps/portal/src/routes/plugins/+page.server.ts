import { fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = () => ({
  plugins: bot()
    .plugins()
    .map((p) => ({
      name: p.plugin.name,
      description: p.plugin.description,
      heuristic: p.plugin.heuristic,
      trigger: p.plugin.trigger._tag,
      enabled: p.enabled,
      history: p.history.slice(0, 10),
    })),
});

export const actions = {
  toggle: async ({ request, locals }) => {
    const form = await request.formData();
    const name = String(form.get("name") ?? "");

    if (!name || !locals.sid64) return fail(400);

    await bot().setEnabled(name, form.get("enabled") === "true", locals.sid64);
  },
  rollback: async ({ request, locals }) => {
    const form = await request.formData();
    const name = String(form.get("name") ?? "");
    const commit = String(form.get("commit") ?? "");

    if (!name || !/^[0-9a-f]{7,40}$/.test(commit) || !locals.sid64) return fail(400);

    await bot().rollback(name, commit, locals.sid64);
  },
};
