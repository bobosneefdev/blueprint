# One-time release setup (repo owner)

These secrets must exist before tagging the first `v*` release. None are committed.

| Secret                                                            | How to get it                                                                                                                                                                                          | Used by                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `bunx tauri signer generate -w ~/.tauri/better-rust.key`. Put the **public** key into `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (replacing the placeholder) and commit that. | Updater artifacts + `latest.json` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                   | Cloudflare dashboard → API token with _Pages: Edit_; create a Pages project named `better-rust`.                                                                                                       | Landing site deploy               |
| `VT_API_KEY` (optional)                                           | virustotal.com account → API key. Without it the release notes say "not configured".                                                                                                                   | VirusTotal link                   |

Also:

- Create `bobosneefdev/better-rust-plugins` from `packages/gallery-template/`, seeded with
  `packages/dsl/starter/*.json`.
- Code signing (Azure Trusted Signing) is deliberately deferred; see SPEC.md.
