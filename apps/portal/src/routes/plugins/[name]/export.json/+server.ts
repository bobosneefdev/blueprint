import { error, json } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

/** Download a plugin to share or submit to the gallery. Plugins hold no secrets or bindings. */
export const GET = ({ params }) => {
  const row = bot()
    .plugins()
    .find((p) => p.plugin.name === params.name);

  if (row === undefined) error(404);

  return json(row.plugin, {
    headers: { "content-disposition": `attachment; filename="${row.plugin.name}.json"` },
  });
};
