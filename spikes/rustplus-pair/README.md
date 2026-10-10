# Spike 1 — Rust+ pairing from Bun on Windows

`bun pair.ts register` then `bun pair.ts listen` (in game: ESC → Rust+ → Pair with Server).

## Verified (2026-10-10)

| Step                                                                                | Linux (Bun 1.4.0) | Windows 11 VM (Bun 1.4.3)     |
| ----------------------------------------------------------------------------------- | ----------------- | ----------------------------- |
| FCM register (Android identity, after a few `PHONE_REGISTRATION_ERROR` retries)     | ok                | ok                            |
| Expo push token                                                                     | ok                | ok                            |
| MCS (push listener) connect                                                         | ok                | ok                            |
| `rustplus.js` loads                                                                 | ok                | ok                            |
| Facepunch `/login` opens in Playwright, warning visible                             | ok (Chromium)     | ok (system Edge, no download) |
| `ReactNativeWebView.postMessage` shim injected via init script + binding round trip | ok                | ok                            |
| "Login with Steam" → steamcommunity.com OpenID                                      | ok                | ok                            |
| `/api/push/register` reachable (403 on bad token)                                   | ok                | —                             |

Real Windows 11 host (user, 2026-10-10): `register` end to end ok: real Steam sign-in →
`postMessage` delivered `{SteamId, Token}` → `/api/push/register` accepted. `listen` connects.

## Not verified yet

- Pair notification → websocket connect → team chat send/receive (needs Rust running in game).

## Findings that change the design

1. **Facepunch now polices third-party sign-in.** `/login` carries a notice: third-party apps must
   sign players in through pages that show the warning, as-is, and must not press Continue for the
   player. Our flow complies: real browser window, Facepunch's page, player clicks.
2. **Portal pairing can't be a pure web redirect.** `login-direct?returnUrl=` only accepts
   `https://app.playrust.com/*`; localhost and trycloudflare URLs are rejected. The token only comes
   back through `ReactNativeWebView.postMessage`, so login must run in a browser the bot controls.
   → Pairing happens on the host PC: portal button (or tray) makes the sidecar launch Edge via
   `playwright-core` with the init-script shim. Remote/phone pairing is not possible.
3. **No `--disable-web-security` needed** (rustplus.js `pair.html` uses it). Init script + exposed
   binding is cleaner and keeps the browser's security model intact.
4. **`bun build` fails on `playwright-core`** (`chromium-bidi` dynamic require). Fix at packaging
   time: mark `playwright-core` external and ship it beside the compiled sidecar, or drive Edge
   over raw CDP (`--remote-debugging-port` + `Page.addScriptToEvaluateOnNewDocument` +
   `Runtime.addBinding`) with no dependency.
5. **`rustplus.proto` has `required` fields** (`queuedPlayers`, `Note.type`) that newer servers omit →
   decode errors (upstream issues, 2026). Plan: vendor the proto with `required` → `optional`.
6. Auth token lasts ~2 weeks per the pairing doc → the bot must detect expiry and prompt re-login.
