import { bot } from "#lib/server/bot.ts";

export const load = () => ({ entries: bot().activity().slice(0, 100) });
