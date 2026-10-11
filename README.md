# Blueprint

A Rust+ team bot you program by asking. Type what you want in team chat; an AI writes a small
plugin, tests it against your server's recent data, and runs it once you confirm.

```
You:   @bot ping us when cargo spawns, with the grid
[bot]  @bot yes 4821 to activate: <portal link>
[bot]  new cargo-alert [chat]
You:   @bot yes 4821
[bot]  cargo-alert is live
[bot]  Cargo Ship spawned at G3
```

Windows, self-hosted, open source (AGPL-3.0). Only uses Rust+, Facepunch's official companion
API: no game memory, no Easy Anti-Cheat interaction.

## Install

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://blueprint.bobosneef.dev/install.ps1 | iex"
```

[Read the script](packages/installer/install.ps1) first. It sets up WSL if needed, downloads the
release, checks SHA256 sums, and installs per-user. Then: tray → Open portal → Sign in with Steam →
in game ESC → Rust+ → Pair with Server.

## How it works

| Piece                                                         | Where                |
| ------------------------------------------------------------- | -------------------- |
| Plugin DSL: Effect Schema + CEL, fixture tests, pure engine   | `packages/dsl`       |
| Rust+ client, poller, runtime, recorder, replay, RPC, pairing | `packages/core`      |
| `bot` CLI the AI uses inside its sandbox                      | `packages/cli`       |
| Bot sidecar (wires everything)                                | `apps/bot`           |
| Web portal (Steam login, plugins, settings)                   | `apps/portal`        |
| Tray app (Tauri)                                              | `apps/desktop`       |
| Installer + WSL sandbox image                                 | `packages/installer` |
| Landing site                                                  | `apps/site`          |

Design decisions and measured results: [SPEC.md](SPEC.md).

## Develop

```sh
bun install
bun run lint && bun run fmt:check
bunx turbo run typecheck test
```

Run the bot locally (Linux/macOS works for everything except the WSL sandbox and Steam sign-in
window): `cd apps/portal && bun run build && cd ../bot && bun src/main.ts`.

Contributors on Windows need `git config core.symlinks true` (and Developer Mode) so
`.claude/skills` checks out as a symlink.

## License

AGPL-3.0-only. Not affiliated with or endorsed by Facepunch Studios.
