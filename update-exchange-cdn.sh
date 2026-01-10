#!/usr/bin/env bash
set -euo pipefail

# ===== paths =====
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGDIR"

LOGFILE="$LOGDIR/fx.log"

# ===== logging (always) =====
if [[ -t 1 ]]; then
  exec > >(tee -a "$LOGFILE") 2>&1
else
  exec >>"$LOGFILE" 2>&1
fi

echo "==================== $(date) ===================="
echo "[FX] Starting update..."

# cron-safe PATH (Homebrew + system)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Always run from repo root
cd "$SCRIPT_DIR"
mkdir -p cdn

API="https://haiti-economie-api.onrender.com"

echo "[FX] 1) Download exchange snapshots..."
curl -sS -f -L --retry 3 --retry-delay 2 \
  "${API}/api/exchange-rates" \
  -o cdn/exchange-latest.json

curl -sS -f -L --retry 3 --retry-delay 2 \
  "${API}/api/dashboard-summary/mini-chart" \
  -o cdn/exchange-mini-chart.json

echo "[FX] 2) Sync with remote (avoid push rejection)..."
git fetch origin
git pull --rebase origin main || {
  echo "[FX] ERROR: rebase failed. Fix conflicts, then run:"
  echo "  cd \"$SCRIPT_DIR\""
  echo "  git status"
  echo "  git add <files>"
  echo "  GIT_EDITOR=true git rebase --continue"
  exit 1
}

echo "[FX] 3) Commit & push (only if changed)..."
git add cdn/exchange-latest.json cdn/exchange-mini-chart.json

if git diff --cached --quiet; then
  echo "[FX] No changes to commit."
else
  ET_DATE="$(TZ="America/New_York" date +%F)"
  git commit -m "Update exchange snapshots ${ET_DATE}"
  git push
fi

SHA="$(git rev-parse HEAD)"

echo "[FX] 4) Purge jsDelivr cache (best effort)..."
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-latest.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-mini-chart.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@${SHA}/cdn/exchange-latest.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@${SHA}/cdn/exchange-mini-chart.json" >/dev/null || true

echo "[FX] ✅ Done. sha=${SHA}"
