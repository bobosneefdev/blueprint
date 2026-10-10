# Windows test plan

Everything below needs a real Windows 10/11 x64 machine with virtualization enabled. Linux CI and
the cross-checks cover the rest (see SPEC.md). Run in order; each step lists what proves it.

## 0. Build artifacts locally (until the release workflow has run once)

```powershell
bun install
cd apps/portal; bun run build; cd ../..
cd apps/bot; bun run build; cd ../..          # dist/better-rust-bot.exe
cd packages/cli; bun run build; cd ../..      # dist/bot (linux musl, for the sandbox)
```

Sandbox image (needs Docker, or use the release artifact):
`docker build -t better-rust-agent packages/installer/rootfs` then
`docker export (docker create better-rust-agent) | gzip > better-rust-agent.tar.gz`.

## 1. Sidecar alone

- `$env:CLOUDFLARED="<path>\cloudflared.exe"; .\apps\bot\dist\better-rust-bot.exe`
- Expect: `portal: https://….trycloudflare.com` in the console and a team-chat line once a server
  is paired.
- `http://127.0.0.1:47614` → redirects to `/pair` on first run.

## 2. Rust+ sign-in and pairing (spike 1 already passed this on the user's PC)

- `/pair` → Sign in with Steam → Edge opens Facepunch's page with their warning → sign in.
- Expect: "Signed in"; `%LOCALAPPDATA%\better-rust\config.json` has `rustplus`.
- In game: ESC → Rust+ → Pair with Server → server appears on `/` within ~10s.
- Pair a smart switch named "Lights" → `workspace\servers\<id>\bindings.json` binds `lights`;
  enable night-lights on `/plugins`.

## 3. Sandbox

- Copy `better-rust-agent.tar.gz` to `%LOCALAPPDATA%\better-rust\`.
- `/harness` → paste a Claude token (`claude setup-token`) or API key → "Saved to the sandbox".
- `wsl -l -v` shows `better-rust-agent` (version 2).
- Escape checks, inside `wsl -d better-rust-agent -u agent`:
  - `ls /mnt` shows no drives; `ls /mnt/host` → permission denied.
  - `cat /workspace/../config.json` → not found (only workspace is bound).
  - `curl -m5 https://example.com` → fails; `curl -m5 https://api.anthropic.com` → connects.
  - `cmd.exe` → not found (interop off).
  - `sudo` → not found.

## 4. Agent loop in game

- Team chat: `@bot how many rockets for a sheet metal door?` → "on it…" then "2".
- `@bot ping us when cargo spawns with the grid` → proposal line → `@bot yes` → "cargo-alert is live"
  (or the starter already covers it; try "tell us when a teammate respawns").
- A non-allowlisted teammate's `@bot …` is ignored; their `@bot yes` does not activate anything.
- `@bot undo` reverts the last plugin change.

## 5. Tray + installer

- `cd apps/desktop; bunx tauri build` (sidecar exe copied to `src-tauri/binaries/better-rust-bot-x86_64-pc-windows-msvc.exe`).
- Install the NSIS setup → tray icon → Open portal works; Quit stops the sidecar (no orphan
  `better-rust-bot.exe` in Task Manager); relaunching shows one instance.
- `install.ps1` end to end against a published release.

## 6. Notifications

- Set an ntfy topic; trigger raid-alarm by tripping the paired alarm → Windows toast + phone push.
