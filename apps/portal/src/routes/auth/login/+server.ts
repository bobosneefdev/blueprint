import { redirect } from "@sveltejs/kit";
import { SteamAuth } from "@better-rust/core";
import { bot } from "#lib/server/bot.ts";

// Quick-tunnel URLs change every start, so realm/return_to come from the current public URL.
export const GET = () => {
  const origin = bot().publicUrl();

  redirect(303, SteamAuth.loginUrl(origin, `${origin}/auth/callback`), {
    external: ["https://steamcommunity.com"],
  });
};
