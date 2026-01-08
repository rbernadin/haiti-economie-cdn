#!/usr/bin/env bash
set -euo pipefail

curl -L https://haiti-economie-api.onrender.com/api/exchange-rates \
  -o cdn/exchange-latest.json

curl -L https://haiti-economie-api.onrender.com/api/dashboard-summary/mini-chart \
  -o cdn/exchange-mini-chart.json

git add cdn/*.json
git commit -m "Update exchange snapshots $(date -u +%F)" || true
git push

curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-latest.json" >/dev/null
curl -L "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-mini-chart.json" >/dev/null

echo "✅ Exchange CDN updated + purged"
