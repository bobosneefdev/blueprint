// Steam OpenID realm/return_to and the session cookie must match the origin the browser is on:
// the tunnel URL for remote users, http://127.0.0.1:<port> for the host on their own PC (the
// tunnel cookie is never sent to 127.0.0.1, so local pages need their own sign-in).
import { bot } from "./bot.ts";

/** Tunnel requests carry cf-connecting-ip (set by Cloudflare); the portal binds to loopback. */
export const isLocal = (request: Request, url: URL) =>
  !request.headers.has("cf-connecting-ip") && ["127.0.0.1", "localhost"].includes(url.hostname);

/**
 * adapter-node reports https for every request unless ORIGIN is set, but loopback is plain http.
 * Rebuild the local origin explicitly so Steam redirects back to a URL the browser can open.
 */
export const authOrigin = (request: Request, url: URL) =>
  isLocal(request, url) ? `http://${url.host}` : bot().publicUrl();
