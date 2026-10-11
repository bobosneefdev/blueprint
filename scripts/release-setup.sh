#!/usr/bin/env bash
# One-time release setup for the repo owner. Run from the repo root on Linux/macOS/WSL:
#   CLOUDFLARE_API_TOKEN=... VT_API_KEY=... bash scripts/release-setup.sh
# Needs: gh (logged in), bun, jq, curl. Secrets go straight into GitHub; nothing is printed.
set -euo pipefail

REPO=bobosneefdev/blueprint
PROJECT=blueprint
DOMAIN=blueprint.bobosneef.dev
ZONE=bobosneef.dev
KEY="$HOME/.tauri/blueprint.key"

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (see docs/release-setup.md)}"
cf() { curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }

echo "1/4 Tauri updater key"
if [ ! -f "$KEY" ]; then
  mkdir -p "$(dirname "$KEY")"
  (umask 077 && openssl rand -base64 24 | tr -d '\n' > "$KEY.password")
  (cd apps/desktop && bunx tauri signer generate --ci -p "$(cat "$KEY.password")" -w "$KEY" >/dev/null)
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R "$REPO" < "$KEY.password"
  gh secret set TAURI_SIGNING_PRIVATE_KEY -R "$REPO" < "$KEY"
  echo "   back up $KEY and $KEY.password: losing them means users can't auto-update"
fi
jq --arg k "$(cat "$KEY.pub")" '.plugins.updater.pubkey = $k' apps/desktop/src-tauri/tauri.conf.json \
  > /tmp/tauri.conf.json && mv /tmp/tauri.conf.json apps/desktop/src-tauri/tauri.conf.json

echo "2/4 Cloudflare account + Pages project"
ACCOUNT=$(cf "https://api.cloudflare.com/client/v4/zones?name=$ZONE" | jq -r '.result[0].account.id')
[ "$ACCOUNT" != "null" ] || { echo "token can't see zone $ZONE"; exit 1; }
printf '%s' "$ACCOUNT" | gh secret set CLOUDFLARE_ACCOUNT_ID -R "$REPO"
printf '%s' "$CLOUDFLARE_API_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
cf "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/$PROJECT" >/dev/null 2>&1 ||
  cf -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects" \
    -d "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" >/dev/null

# pages.dev subdomains are global; Cloudflare picks blueprint-xyz.pages.dev if blueprint is taken.
SUB=$(cf "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/$PROJECT" | jq -r .result.subdomain)

echo "3/4 $DOMAIN -> $SUB"
cf -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/pages/projects/$PROJECT/domains" \
  -d "{\"name\":\"$DOMAIN\"}" >/dev/null 2>&1 || true
ZONE_ID=$(cf "https://api.cloudflare.com/client/v4/zones?name=$ZONE" | jq -r '.result[0].id')
if [ "$(cf "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$DOMAIN" | jq '.result | length')" = 0 ]; then
  cf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
    -d "{\"type\":\"CNAME\",\"name\":\"$DOMAIN\",\"content\":\"$SUB\",\"proxied\":true}" >/dev/null
fi

echo "4/4 VirusTotal"
if [ -n "${VT_API_KEY:-}" ]; then printf '%s' "$VT_API_KEY" | gh secret set VT_API_KEY -R "$REPO"; else echo "   skipped (no VT_API_KEY)"; fi

echo "Done. Commit the pubkey: git commit -am 'chore: updater pubkey' && git push"
