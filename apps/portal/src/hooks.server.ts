import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { bot } from "#lib/server/bot.ts";
import * as Session from "#lib/server/session.ts";

const PUBLIC = ["/auth/login", "/auth/callback"];

/** Everything except the login flow requires the host or an allowlisted SID64. */
export const handle: Handle = async ({ event, resolve }) => {
  const b = bot();
  const sid64 = Session.read(b.sessionSecret, event.cookies.get("session"));

  event.locals.sid64 = sid64;

  if (PUBLIC.includes(event.url.pathname)) return resolve(event);

  if (sid64 === undefined) redirect(303, "/auth/login");

  if (sid64 !== b.hostSteamId && !b.allowlist().includes(sid64))
    return new Response("Forbidden: ask the host to add your Steam account.", { status: 403 });

  return resolve(event);
};
