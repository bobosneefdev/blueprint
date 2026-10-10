# better-rust — Spec (codename)

LLM-authored Rust+ team bot. Players request features in team chat; an agent harness writes
validated, tested plugins in a declarative DSL; the bot runs them.

## Product

- **Self-hosted, Windows only.** One-line install:
  `powershell -ExecutionPolicy ByPass -c "irm https://<site>/install.ps1 | iex"`.
- **Open source, AGPL-3.0, reputation first.** No telemetry, no payments. Only phone-home is the
  update check against GitHub Releases.
- **Launch:** r/playrust + 60s demo video ("@bot alert me when cargo spawns" → alert fires).
- **Trust (ships unsigned):** public CI builds with SHA256 sums + build provenance attestations,
  VirusTotal link per release, "Not a cheat" FAQ (official Rust+ API only, no game memory, no EAC
  interaction), short commented readable `install.ps1`.

## Identity & permissions

- Steam OpenID is the only login, for the portal and for anything else. SID64 is the sole identity.
- Non-host, non-allowlisted SID64 → 403.
- **Host + allowlist:** talk to the agent, create/edit/disable plugins.
- **Any teammate:** run existing plugin `/commands`, per-user rate limited.

## Chat UX

- `@<name> <request>` → agent. Name configurable in settings, default `bot`.
- `/<command>` → installed plugin. Unknown commands suggest closest match; never fall to the LLM.
- Instant ack ("on it…"), reply in 1–3 messages (~128 chars each), overflow →
  `full answer: <portal>/r/<id>`. One agent job per requester; others queue.
- Every `@bot` message goes to the harness; the system prompt routes Q&A vs plugin authoring.
- Impossible requests (AFK, inventory, enemies, raids w/o alarm): say what's unavailable, offer the
  closest labelled heuristic. Never fake it.

## Agent

- **Harnesses:** Claude Code, Codex, Pi — driven headless via their JSON stream modes, T3 Code
  style. All run with permission prompts bypassed; the sandbox is the boundary.
- **Sandbox:** dedicated WSL2 distro `better-rust-agent` (`wsl --import` of a minimal rootfs).
  `/etc/wsl.conf`: automount off, interop off. Non-root user. Sees only `/workspace` and read-only
  `/data/rust-items-json`. Network: LLM provider endpoints only.
- **Auth:** portal "Harnesses" page runs `claude login` / `codex login` inside the distro and relays
  the URL to the host's browser; Pi takes a pasted provider key. Credentials never leave the distro.
- **Sessions:** one resumable harness session per SID64; reset on idle timeout or wipe.
- **Interface:** workspace files + `bot` CLI. CLI talks to the Windows bot over localhost RPC with a
  per-session token.
  - `bot team | markers | time | info | devices` — live data
  - `bot items search|get` — game data
  - `bot validate <plugin>` — schema + fixture tests
  - `bot dry-run <plugin> [--from 2h]` — replay recordings, report what would fire
  - `bot propose <plugin>` — post chat summary, await requester confirm

## Plugin DSL

Effect Schema is the single source of truth (types, validation, JSON Schema for the agent).

```
Plugin {
  name, description, version
  trigger:  Command{name,args} | Schedule{every|cron} | CommandAndSchedule | Event{kind,filter}
  conditions: CEL expressions
  state:    declared keys + defaults (KV per plugin per server)
  actions:  TeamChat | SmartSwitch{binding,on} | SetState | Notify{toast|ntfy}
  bindings: named slots (entity ids, coordinates) filled per server
  heuristic?: label shown when logic approximates unavailable data
  tests:    fixtures { input events/snapshots → expected actions }   (required)
}
```

- Expressions: **CEL** (non-Turing-complete, no I/O).
- Event kinds: team changes, markers (cargo/heli/chinook/vending), smart alarm/switch/storage,
  team chat, time-of-day, wipe.

## Runtime

- **Central poller:** one poll per data source per server, fanned out to subscribed plugins. Respects
  Rust+ per-player/per-IP token buckets.
- **Chat budget:** per-plugin message budget, duplicate coalescing.
- **Go-live:** `validate` (schema + fixtures) → `dry-run` (replay) → chat summary → requester
  confirms → git commit → active. `@bot undo` / portal click rolls back.
- **Recording:** all polled + pushed data (team chat text excluded by default) into SQLite,
  compressed, rolling 7 days per server, pruned on wipe.
- **Wipe:** detected via seed/wipe-time change. Plugins persist; bound plugins pause as
  `unbound`; bot asks to re-pair/redefine.
- **Multi-server:** one instance, many paired servers.

## Workspace (git repo, mounted into WSL)

```
plugins/<name>.json            global logic
servers/<id>/bindings.json     entity ids, coords, enabled flags
```

## Game data

`bobosneefdev/rust-items-json` pulled on startup + daily, mounted read-only for the agent,
queryable via `bot items`, readable by plugins at runtime.

## Portal

SvelteKit, served by the sidecar, exposed through a Cloudflare quick tunnel. URL changes every
start: bot posts it to team chat + tray; OpenID `return_to` derived from the current URL.
Pages: pairing (button launches Steam login in Edge on the host PC, FCM register, auto-accept in-game pair
notifications), plugins (list, diff, history, enable/disable, rollback), logs, harnesses, settings
(bot name, allowlist, ntfy topic), gallery import, live map (Three.js WebGPU).

## v1 scope

Core + starter plugin pack (~10 reviewed), gallery (export/import), multi-server, recorded replay.

## Gallery

`better-rust-plugins` GitHub repo. PRs validated by CI against the DSL schema. Landing site builds
a browsable index at deploy. Portal imports from raw GitHub URLs.

## Distribution & updates

- Tauri tray app wrapping a Bun sidecar (`bun build --compile`) containing bot + portal + RPC.
- `install.ps1` → enables WSL if needed, downloads Tauri installer + rootfs, `wsl --import`.
- Tauri updater + GitHub Releases, stable/beta channel. Updates app, sidecar and rootfs together.
- Unsigned at launch.

## Stack

| Concern                         | Choice                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Language / runtime / pm / tests | TypeScript, Bun                                                               |
| Types, schemas, services        | Effect v4 everywhere (incl. SvelteKit server), `effect/cli`, `effect/rpc`     |
| Monorepo                        | Turborepo                                                                     |
| Bundler                         | tsdown (packages), Vite (SvelteKit)                                           |
| Lint / format                   | Oxlint + vendored anti-slop (generic + Effect rules), Oxfmt                   |
| Web                             | Svelte 5, SvelteKit, DaisyUI, Bits UI, Motion, Shaders.com, Three.js (WebGPU) |
| Desktop                         | Tauri 2                                                                       |
| DB                              | SQLite (`bun:sqlite`) + Drizzle                                               |
| Rust+                           | `@liamcottle/rustplus.js` (pinned)                                            |
| Expressions                     | CEL                                                                           |
| Site                            | Cloudflare Pages (landing, docs, `install.ps1`, gallery index)                |
| CI / releases                   | GitHub Actions + Releases                                                     |

## Repo layout

```
apps/desktop    Tauri tray shell (Rust)
apps/portal     SvelteKit portal (served by sidecar)
apps/site       Cloudflare Pages landing/docs/gallery index
packages/core   bot runtime: Rust+ client, poller, scheduler, plugin engine, recorder, RPC server
packages/dsl    plugin schema (Effect Schema) + CEL evaluation
packages/cli    `bot` CLI used by the agent inside WSL
packages/installer  install.ps1 + WSL rootfs build
tools/oxlint/anti-slop  vendored lint rules
```

## Rust+ pairing (spike 1 findings)

- Steam login runs on the host PC only: sidecar launches system Edge (`playwright-core` or raw CDP)
  at Facepunch's `/login`, injects a `ReactNativeWebView.postMessage` shim, player signs in. No
  remote/phone pairing (Facepunch `returnUrl` allowlist is `app.playrust.com` only).
- Must show Facepunch's third-party warning unaltered; never press Continue for the player.
- Vendor `rustplus.proto` with `required` → `optional`.
- Detect Rust+ auth token expiry (~2 weeks) and prompt re-login.

## Sandbox verification (Windows 11 VM, WSL 3.0.1, real WSL2 distro, 2026-10-10)

As the `agent` user with the shipped `wsl.conf` + `egress-firewall`: Windows drives not mounted,
`cmd.exe` (interop) unavailable, no `sudo`, arbitrary HTTPS rejected; `api.anthropic.com`, DNS and
the bot RPC port on the Windows host reachable; musl `bot` CLI runs. Found and fixed: the default
route parse picked up two lines on WSL2 (`default via` + a second route line). After the security
review: DNS only to the distro resolver (1.1.1.1 blocked), other loopback ports (portal) and other
Windows host ports blocked; a drvfs mount of one Windows directory does not expose its parent, but
drvfs ignores `ro` for the agent, so game data is copied in rather than mounted.

## Agent quality (measured 2026-10-10, real harness runs against the bot CLI)

- Sonnet-class: correct on raid/craft Q&A (3/3, 2-3 turns, ~$0.04), writes valid plugins first try
  once `bot schema` exposes event payloads, and refuses impossible requests (enemy inventories)
  while offering a heuristic plugin with `heuristic` filled in.
- Haiku-class: unreliable on Q&A (1/3 correct, 2-41 turns, recomputed numbers instead of using
  `bot raid`). Do not default to small models; warn in settings when one is chosen.
- Fixture payload enforcement was added after a real run produced a passing plugin that read a
  field the server never sends.

## Open

- Project name (codename `better-rust`).
