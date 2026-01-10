#!/usr/bin/env bash
set -euo pipefail

# cron-safe PATH (Homebrew + system)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Always run from repo root (where this script lives)
cd "$(dirname "$0")"

# Logging (works for cron + manual runs)
mkdir -p logs cdn
LOGFILE="logs/home.log"
exec >>"$LOGFILE" 2>&1
echo "----- HOME $(date) -----"

API="https://haiti-economie-api.onrender.com"

echo "1) Download home snapshot..."
curl -sS -L "${API}/api/home-snapshot?refresh=1" -o cdn/home-snapshot.json

echo "2) Commit & push (only if changed)..."
git add cdn/home-snapshot.json

if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Update home snapshot $(date -u +%F)" || true
  git push
fi

echo "3) Purge jsDelivr cache (best effort)..."
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/home-snapshot.json" >/dev/null || true

echo "✅ Home snapshot CDN updated + purged"

