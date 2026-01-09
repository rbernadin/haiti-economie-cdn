#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")"
mkdir -p cdn logs

# Update exchange snapshots (daily-ish)
curl -L "https://haiti-economie-api.onrender.com/api/exchange-rates" \
  -o cdn/exchange-latest.json

curl -L "https://haiti-economie-api.onrender.com/api/dashboard-summary/mini-chart" \
  -o cdn/exchange-mini-chart.json

git add cdn/exchange-latest.json cdn/exchange-mini-chart.json
git commit -m "Update exchange snapshots $(date -u +%F)" || true
git push

# Purge jsDelivr caches
curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-latest.json" >/dev/null
curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-mini-chart.json" >/dev/null

echo "✅ Exchange CDN updated + purged"

