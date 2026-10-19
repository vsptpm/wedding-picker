#!/usr/bin/env bash
# Copies the live database (selections, notes, rotations, Drive links) to ./data for local development.
# The server's copy is never modified. Usage: npm run pull-db [-- ssh-host]
set -euo pipefail
HOST="${1:-trading-server}"
APP=/var/www/html/wedding-picker
cd "$(dirname "$0")/.."
mkdir -p data
# Consistent snapshot even while people are using the site (SQLite online backup).
ssh "$HOST" "cd $APP && node -e 'require(\"better-sqlite3\")(\"/srv/wedding/data/picker.db\", { readonly: true }).backup(\"/tmp/picker-snapshot.db\").then(() => console.log(\"snapshot ready\"))'"
[ -f data/picker.db ] && mv data/picker.db "data/picker.local-backup-$(date +%Y%m%d-%H%M%S).db" && rm -f data/picker.db-wal data/picker.db-shm
scp -q "$HOST:/tmp/picker-snapshot.db" data/picker.db
ssh "$HOST" "rm -f /tmp/picker-snapshot.db"
echo "Pulled live database → data/picker.db (restart 'npm run dev' to see it)"
