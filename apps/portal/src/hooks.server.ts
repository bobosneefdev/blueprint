import { redirect } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { bot } from "#lib/server/bot.ts";
import { isLocal } from "#lib/server/origin.ts";
import * as Session from "#lib/server/session.ts";

// Matched on route ids, never on the raw pathname: SvelteKit decodes %-escapes when routing, so
// "/p%61ir" reaches the /pair route while a pathname check would not match it.
const PUBLIC = new Set(["/auth/login", "/auth/callback"]);

const LOCAL_ONLY = new Set(["/setup"]);

/** Everything except the login flow requires the host or a teammate with a role on some server. */
export const handle: Handle = async ({ event, resolve }) => {
  const b = bot();
  const sid64 = Session.read(b.sessionSecret, event.cookies.get("session"));
  const local = isLocal(event.request, event.url);

  event.locals.sid64 = sid64;
  event.locals.local = local;

  // First run and Rust+ sign-in happen on the host PC only; nobody can claim host remotely.
  const route = event.route.id ?? "";

  if (LOCAL_ONLY.has(route)) {
    if (!local) return new Response("Only available on the host PC.", { status: 403 });

    // First run has no host yet; afterwards these need the host's own session too, so another
    // local process (or a sandbox that reaches loopback) cannot use them anonymously.
    if (b.pairing().hostSteamId !== "" && sid64 !== b.hostSteamId()) redirect(303, "/auth/login");

    return resolve(event);
  }

  if (b.pairing().hostSteamId === "")
    return local
      ? redirect(303, "/setup")
      : new Response("Setup not finished on the host PC.", { status: 403 });

  if (PUBLIC.has(route)) return resolve(event);

  if (sid64 === undefined) redirect(303, "/auth/login");

  const role = b.role(sid64);

  if (role === "none")
    return new Response("Forbidden: ask the host to give you a role.", { status: 403 });

  event.locals.role = role;

  return resolve(event);
};
