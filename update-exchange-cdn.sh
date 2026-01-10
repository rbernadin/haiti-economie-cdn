#!/usr/bin/env bash
set -euo pipefail

<<<<<<< HEAD
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

=======
# cron-safe PATH (Homebrew + system + whatever the shell already has)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p cdn cdn/daily logs

LOG="$ROOT/logs/fx.log"
if [[ -t 1 ]]; then
  exec > >(tee -a "$LOG") 2>&1
else
  exec >>"$LOG" 2>&1
fi

echo "----- FX $(date) -----"

API="https://haiti-economie-api.onrender.com"

echo "0) Check python3..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "[FX] ERROR: python3 not found. (macOS should have /usr/bin/python3)"
  exit 127
fi

echo "1) Download exchange snapshots..."
curl -sS -f -L --retry 3 --retry-delay 2 \
  "${API}/api/exchange-rates" \
  -o cdn/exchange-latest.json

>>>>>>> 119a4e8 (Publish daily exchange legacy files (no Node))
curl -sS -f -L --retry 3 --retry-delay 2 \
  "${API}/api/dashboard-summary/mini-chart" \
  -o cdn/exchange-mini-chart.json

<<<<<<< HEAD
echo "[FX] 2) Sync with remote (avoid push rejection)..."
git fetch origin
git pull --rebase origin main || {
  echo "[FX] ERROR: rebase failed. Fix conflicts, then run:"
  echo "  cd \"$SCRIPT_DIR\""
=======
echo "2) Build legacy daily files the iOS app requests..."
# iOS expects: daily/exchange-summary.json
cp -f cdn/exchange-latest.json cdn/daily/exchange-summary.json

# iOS expects: daily/ref-tma-history.json
python3 - <<'PY'
import json, os

with open("cdn/exchange-latest.json", "r", encoding="utf-8") as f:
    raw = json.load(f)

chart = raw.get("chart") or {}
labels = chart.get("labels") or []
ref = chart.get("refData") or []
tma = chart.get("tmaData") or []

n = max(len(labels), len(ref), len(tma))
history = []
for i in range(n):
    history.append({
        "date": labels[i] if i < len(labels) else None,
        "ref": ref[i] if i < len(ref) else None,
        "tma": tma[i] if i < len(tma) else None,
    })

os.makedirs("cdn/daily", exist_ok=True)
with open("cdn/daily/ref-tma-history.json", "w", encoding="utf-8") as out:
    json.dump({"history": history}, out, ensure_ascii=False)
PY

echo "3) Sync with remote (avoid push rejection)..."
git fetch origin
git pull --rebase origin main || {
  echo "[FX] ERROR: rebase failed. Fix conflicts, then run:"
>>>>>>> 119a4e8 (Publish daily exchange legacy files (no Node))
  echo "  git status"
  echo "  git add <files>"
  echo "  GIT_EDITOR=true git rebase --continue"
  exit 1
}

<<<<<<< HEAD
echo "[FX] 3) Commit & push (only if changed)..."
git add cdn/exchange-latest.json cdn/exchange-mini-chart.json
=======
echo "4) Commit & push (only if changed)..."
git add \
  cdn/exchange-latest.json \
  cdn/exchange-mini-chart.json \
  cdn/daily/exchange-summary.json \
  cdn/daily/ref-tma-history.json
>>>>>>> 119a4e8 (Publish daily exchange legacy files (no Node))

if git diff --cached --quiet; then
  echo "[FX] No changes to commit."
else
<<<<<<< HEAD
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
=======
  git commit -m "Update exchange snapshots $(date -u +%F)"
  git push
fi

echo "5) Purge jsDelivr cache (best effort)..."
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-latest.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/exchange-mini-chart.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/daily/exchange-summary.json" >/dev/null || true
curl -sS "https://purge.jsdelivr.net/gh/rbernadin/haiti-economie-cdn@main/cdn/daily/ref-tma-history.json" >/dev/null || true
>>>>>>> 119a4e8 (Publish daily exchange legacy files (no Node))

echo "[FX] ✅ Done. sha=${SHA}"
