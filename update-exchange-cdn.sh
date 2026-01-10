#!/usr/bin/env bash
set -euo pipefail

# cron-safe PATH (Homebrew + system)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Always run from repo root (where this script lives)
cd "$(dirname "$0")"

# Logging (works for cron + manual runs)
mkdir -p logs cdn
LOGFILE="logs/fx.log"
exec >>"$LOGFILE" 2>&1
echo "----- FX $(date) -----"

API="https://haiti-economie-api.onrender.com"

echo "1) Download exchange snapshots..."
curl -sS -L "${API}/api/exchange-rates" -o cdn/exchange-latest.json
curl -sS -L "${API}/api/dashboard-summary/mini-chart" -o cdn/exchange-mini-chart.json

echo "2) Commit & push (only if changed)..."
git add cdn/exchange-latest.json cdn/exchange-mini-chart.json

if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Update exchange snapshots $(date -u +%F)" || true
  git push
fi

echo "3) Purge jsDelivr cache (best effort)..."
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-latest.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-mini-chart.json" >/dev/null || true

echo "✅ Exchange CDN updated + purged"

