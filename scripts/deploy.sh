#!/usr/bin/env bash
# Auto-deploy: run every minute from cron on the server.
# If GitHub has new commits on the current branch, pull them, install
# packages, run the tests, and restart the app only if the tests pass.
# Log: data/deploy.log    Setup: see README "Automatic deploy".
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
LOG=data/deploy.log
exec 9>data/.deploy.lock
flock -n 9 || exit 0                       # a deploy is already running
log() { echo "$(date -u '+%F %T') $*" >> "$LOG"; }

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" || { log "fetch failed"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0         # nothing new

log "new commits $LOCAL -> $REMOTE"
if ! git merge -q --ff-only "origin/$BRANCH" >> "$LOG" 2>&1; then
  log "cannot fast-forward (local changes on the server?); not deploying"; exit 1
fi
if ! git diff --quiet "$LOCAL" HEAD -- package.json package-lock.json; then
  npm ci --omit=dev >> "$LOG" 2>&1 || { log "npm ci failed; rolling back"; git reset -q --hard "$LOCAL"; exit 1; }
fi
if ! npm test >> "$LOG" 2>&1; then
  log "tests failed; rolling back to $LOCAL"
  git reset -q --hard "$LOCAL"; npm ci --omit=dev >> "$LOG" 2>&1
  exit 1
fi
pm2 restart boiler-room >> "$LOG" 2>&1 && log "deployed $(git log -1 --format='%h %s')"
# keep the log short
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
