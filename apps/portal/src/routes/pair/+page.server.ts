import { fail } from "@sveltejs/kit";
import { bot } from "#lib/server/bot.ts";

export const load = () => bot().pairing();

export const actions = {
  default: async () => {
    try {
      return { pairedAs: await bot().pair() };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : String(e) });
    }
  },
};
