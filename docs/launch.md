# Launch: r/playrust

## Demo video (60s, no voiceover; captions only)

| t      | Shot                                                                  | Caption                                                                  |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0-4s   | In game, team chat open, base at night                                | "What if you could just ask your Rust+ bot for a feature?"               |
| 4-12s  | Type `@bot ping us when cargo spawns, with the grid`                  | "Type it in team chat."                                                  |
| 12-18s | `[bot] on it…` → proposal line                                        | "It writes the plugin and tests it on your server's recent data."        |
| 18-22s | `@bot yes <code>` → `cargo-alert is live`                             | "You confirm."                                                           |
| 22-30s | Cargo spawns → `[bot] Cargo Ship spawned at G3`, map overlay shows it | "Done."                                                                  |
| 30-38s | `@bot how many rockets for a sheet metal door?` → `2`                 | "Ask it anything, using game data pulled from Rust's files every patch." |
| 38-46s | `@bot tell us when enemies are near base` → honest answer + heuristic | "It tells you when Rust+ can't do something."                            |
| 46-54s | Portal: plugins, history diff, live map on phone                      | "Manage everything from your phone."                                     |
| 54-60s | Install line on screen                                                | "Free and open source. Windows. Link in comments."                       |

Record on a real server with the team's permission, and crop out player names that aren't yours.

## Post

Title: **I made a Rust+ bot you program by typing in team chat (open source)**

Body (short, no hype):

- What it is: one paragraph and the GIF.
- How it stays safe: official Rust+ API only, no game memory or EAC interaction; the AI runs in
  a locked-down sandbox; open source and built in public with checksums.
- What it can't do: no enemy positions or inventories, because Rust+ doesn't expose them.
- Link to GitHub + install line. Ask for feature requests in the comments and turn the good ones
  into gallery plugins live.

## Before posting

- [ ] Windows test plan passes on a clean machine
- [ ] Release published by CI (checksums, attestation, VirusTotal link)
- [ ] Gallery repo created and seeded
- [x] Project name decided: Blueprint
