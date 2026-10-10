import { error } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = ({ params }) => {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(params.name) || !/^[0-9a-f]{7,40}$/.test(params.commit))
    error(404);

  return { name: params.name, commit: params.commit, diff: bot().diff(params.name, params.commit) };
};
