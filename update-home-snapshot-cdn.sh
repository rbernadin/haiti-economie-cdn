#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")"
mkdir -p cdn logs

# 1) pull snapshot from API
curl -L "https://haiti-economie-api.onrender.com/api/home-snapshot?refresh=1" \
  -o cdn/home-snapshot.json

# 2) commit & push
git add cdn/home-snapshot.json
git commit -m "Update home snapshot $(date -u +%F)" || true
git push

# 3) purge jsDelivr cache
curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/home-snapshot.json" >/dev/null

echo "✅ Home snapshot CDN updated + purged"

