import { error } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = async ({ params }) => {
  const s = bot()
    .servers()
    .find((x) => x.id === params.id);

  if (s === undefined) error(404);

  return { id: s.id, name: s.name, oceanMargin: (await bot().mapImage(s.id))?.oceanMargin ?? 0 };
};
