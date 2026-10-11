# Windows test plan

Everything below needs a real Windows 10/11 x64 machine with virtualization enabled. Linux CI and
the cross-checks cover the rest (see SPEC.md). Run in order; each step lists what proves it.

Already verified on the Windows 11 VM (2026-10-10), see SPEC.md: all test suites natively, the
compiled sidecar booting, WSL2 sandbox isolation (drives, interop, sudo, egress, DNS, loopback),
and the sandboxed `bot` CLI reaching the real bot RPC. Still needs a person: §2 (Steam sign-in
window + in-game pairing), §4 (live agent in chat, needs an AI signed in via /setup),
§5 (tray + NSIS installer), §6 (toast/phone).

If anything misbehaves, the bot's output is in `%LOCALAPPDATA%\blueprint\blueprint.log`.

## 0. Build artifacts locally (until the release workflow has run once)

```powershell
bun install
cd apps/portal; bun run build; cd ../..
cd apps/bot; bun run build; cd ../..          # dist/blueprint-bot.exe
cd packages/cli; bun run build; cd ../..      # dist/bot (linux musl, for the sandbox)
```

Sandbox image (needs Docker, or use the release artifact):
`docker build -t blueprint-agent packages/installer/rootfs` then
`docker export (docker create blueprint-agent) | gzip > blueprint-agent.tar.gz`.

## 1. Sidecar alone

- `$env:CLOUDFLARED="<path>\cloudflared.exe"; .\apps\bot\dist\blueprint-bot.exe`
- Expect: `portal: https://….trycloudflare.com` in the console and a team-chat line once a server
  is paired.
- `http://127.0.0.1:47614` → redirects to `/setup` on first run.

## 2. Rust+ sign-in and pairing (spike 1 already passed this on the user's PC)

- `/setup` step 1 → Sign in with Steam → Edge opens Facepunch's page with their warning → sign in.
- Expect: step 1 ticks; `%LOCALAPPDATA%\blueprint\config.json` has `rustplus`; the portal is
  signed in without a second Steam login.
- In game: ESC → Rust+ → Pair with Server → server appears on `/` within ~10s.
- Pair a smart switch named "Lights" → `workspace\servers\<id>\bindings.json` binds `lights`;
  enable night-lights on `/plugins`.

## 3. Sandbox

- Copy `blueprint-agent.tar.gz` to `%LOCALAPPDATA%\blueprint\`.
- `/setup` step 2 lists Claude Code, Codex and Pi with versions. "Sign in with Claude" opens
  claude.com; paste the code back. "Sign in with ChatGPT" shows a device code for openai.com.
  Both end "Signed in". `/settings` then lists that AI's live models, reasoning levels and fast mode.
- `wsl -l -v` shows `blueprint-agent` (version 2).
- Escape checks, inside `wsl -d blueprint-agent -u agent`:
  - `ls /mnt` shows no drives.
  - `ls /workspace/..` shows the distro root, not the Windows data dir (only agent-share is mounted).
  - `curl -m5 https://example.com` → fails; `curl -m5 https://api.anthropic.com` → connects.
  - `cmd.exe` → not found (interop off).
  - `sudo` → not found.

## 4. Agent loop in game

- Team chat: `@bot how many rockets for a sheet metal door?` → "on it…" then "2".
- `@bot ping us when cargo spawns with the grid` → proposal line → `@bot yes <code>` → "cargo-alert is live"
  (or the starter already covers it; try "tell us when a teammate respawns").
- A non-allowlisted teammate's `@bot …` is ignored; their `@bot yes <code>` does not activate anything.
- `@bot undo` reverts the last plugin change.

## 5. Tray + installer

- `cd apps/desktop; bunx tauri build` (sidecar exe copied to `src-tauri/binaries/blueprint-bot-x86_64-pc-windows-msvc.exe`).
- Install the NSIS setup → tray icon → Open portal works; Quit stops the sidecar (no orphan
  `blueprint-bot.exe` in Task Manager); relaunching shows one instance.
- `install.ps1` end to end against a published release.

## 6. Notifications

- Set an ntfy topic; trigger raid-alarm by tripping the paired alarm → Windows toast + phone push.
