#!/usr/bin/env bash
set -euo pipefail

# ===== paths =====
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGDIR"

LOGFILE="$LOGDIR/home.log"

# ===== logging (always) =====
if [[ -t 1 ]]; then
  exec > >(tee -a "$LOGFILE") 2>&1
else
  exec >>"$LOGFILE" 2>&1
fi

echo "==================== $(date) ===================="
echo "[HOME] Starting update..."

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$SCRIPT_DIR"
mkdir -p cdn

API="https://haiti-economie-api.onrender.com"

echo "[HOME] 1) Download home snapshot..."
curl -sS -f -L --retry 3 --retry-delay 2 \
  "${API}/api/home-snapshot?refresh=1" \
  -o cdn/home-snapshot.json

echo "[HOME] 2) Sync with remote (avoid push rejection)..."
git fetch origin
git pull --rebase origin main || {
  echo "[HOME] ERROR: rebase failed. Fix conflicts, then run:"
  echo "  cd \"$SCRIPT_DIR\""
  echo "  git status"
  echo "  git add <files>"
  echo "  GIT_EDITOR=true git rebase --continue"
  exit 1
}

echo "[HOME] 3) Commit & push (only if changed)..."
git add cdn/home-snapshot.json

if git diff --cached --quiet; then
  echo "[HOME] No changes to commit."
else
  ET_DATE="$(TZ="America/New_York" date +%F)"
  git commit -m "Update home snapshot ${ET_DATE}"
  git push
fi

SHA="$(git rev-parse HEAD)"

echo "[HOME] 4) Purge jsDelivr cache (best effort)..."
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/home-snapshot.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@${SHA}/cdn/home-snapshot.json" >/dev/null || true

echo "[HOME] ✅ Done. sha=${SHA}"
