#!/usr/bin/env bash
set -euo pipefail

# 1) Regenerate snapshot from API
curl -L https://haiti-economie-api.onrender.com/api/home-snapshot \
  -o cdn/home-snapshot.json

# 2) Commit + push if changed
git add cdn/home-snapshot.json
git commit -m "Update home snapshot $(date -u +%F)" || true
git push

# 3) Purge jsDelivr so @main gets fresh content immediately
curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/home-snapshot.json" >/dev/null

echo "✅ Home snapshot CDN updated + purged"
