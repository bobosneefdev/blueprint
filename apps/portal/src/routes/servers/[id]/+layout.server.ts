import { error } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = ({ params }) => {
  const s = bot()
    .servers()
    .find((x) => x.id === params.id);

  if (s === undefined) error(404);

  return { id: s.id, name: s.name };
};
