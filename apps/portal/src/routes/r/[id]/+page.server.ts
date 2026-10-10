import { error } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

/** Full agent replies that did not fit in Rust team chat. */
export const load = ({ params }) => {
  const text = bot().reply(params.id);

  if (text === undefined) error(404, "Reply expired");

  return { text };
};
