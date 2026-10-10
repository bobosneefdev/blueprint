import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { bot } from "#lib/server/bot.ts";
import * as Session from "#lib/server/session.ts";

const PUBLIC = ["/auth/login", "/auth/callback"];

/**
 * Requests through the tunnel always carry cf-connecting-ip (cloudflared sets it); the portal
 * only listens on 127.0.0.1, so a request without it came from this PC.
 */
const isLocal = (request: Request, url: URL) =>
  !request.headers.has("cf-connecting-ip") && ["127.0.0.1", "localhost"].includes(url.hostname);

/** Everything except the login flow requires the host or an allowlisted SID64. */
export const handle: Handle = async ({ event, resolve }) => {
  const b = bot();
  const sid64 = Session.read(b.sessionSecret, event.cookies.get("session"));
  const local = isLocal(event.request, event.url);

  event.locals.sid64 = sid64;
  event.locals.local = local;

  // First run and Rust+ sign-in happen on the host PC only; nobody can claim host remotely.
  if (event.url.pathname === "/pair" || event.url.pathname === "/harness")
    return local
      ? resolve(event)
      : new Response("Pairing is only available on the host PC.", { status: 403 });

  if (b.pairing().hostSteamId === "")
    return local
      ? redirect(303, "/pair")
      : new Response("Setup not finished on the host PC.", { status: 403 });

  if (PUBLIC.includes(event.url.pathname)) return resolve(event);

  if (sid64 === undefined) redirect(303, "/auth/login");

  if (sid64 !== b.hostSteamId && !b.allowlist().includes(sid64))
    return new Response("Forbidden: ask the host to add your Steam account.", { status: 403 });

  return resolve(event);
};
