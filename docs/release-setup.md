# One-time release setup (repo owner)

`scripts/release-setup.sh` does all of it. You only fetch two keys.

1. **Cloudflare token**:
   [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) →
   Create Token → Create Custom Token. Add these permissions:
   - Account · Cloudflare Pages · Edit
   - Zone · DNS · Edit
   - Zone · Zone · Read

   Under Zone Resources pick Specific zone → `bobosneef.dev`, then create and copy the token.

2. **VirusTotal key**: sign in at
   [virustotal.com/gui/my-apikey](https://www.virustotal.com/gui/my-apikey) and copy the key.
3. Run this from the repo root. The leading space keeps the keys out of shell history:

   ```sh
    CLOUDFLARE_API_TOKEN=paste VT_API_KEY=paste bash scripts/release-setup.sh
   ```

It generates the Tauri updater key into `~/.tauri/blueprint.key` (password in
`~/.tauri/blueprint.key.password`). Back up both files.
**Losing it means existing installs can never auto-update again.** It also:

- writes the public key into `tauri.conf.json`;
- sets every GitHub secret;
- creates the `blueprint` Pages project;
- points `blueprint.bobosneef.dev` at it.

Commit the pubkey change it prints.

Code signing (Azure Trusted Signing) is deliberately deferred; see SPEC.md.
