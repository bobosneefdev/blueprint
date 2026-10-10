import { error, redirect } from "@sveltejs/kit";
import { SteamAuth } from "@better-rust/core";
import { bot } from "#lib/server/bot.ts";
import * as Session from "#lib/server/session.ts";

export const GET = async ({ url, cookies }) => {
  const b = bot();
  const sid64 = await SteamAuth.verify(url.searchParams, `${b.publicUrl()}/auth/callback`);

  if (sid64 === undefined) error(401, "Steam sign-in could not be verified.");

  cookies.set("session", Session.issue(b.sessionSecret, sid64), {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 86400,
  });
  redirect(303, "/");
};
