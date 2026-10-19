#!/usr/bin/env bash
# Ship code changes to the server: build here, copy, restart.
# Usage: ./deploy/update.sh [ssh-host]      (default: trading-server)
set -euo pipefail
HOST="${1:-trading-server}"
APP=/var/www/html/wedding-picker
cd "$(dirname "$0")/.."

npm run build
# Anchored excludes: .next/node_modules holds Turbopack's aliases for native modules and must be copied.
rsync -a --delete \
  --exclude /node_modules --exclude /data --exclude /.env.local --exclude /.git \
  --exclude /.next/cache --exclude tsconfig.tsbuildinfo \
  ./ "$HOST:$APP/"
ssh "$HOST" "cd $APP && npm ci --omit=dev --no-audit --no-fund >/dev/null && sudo systemctl restart wedding-picker && sleep 3 && curl -s -o /dev/null -w 'app: %{http_code}\n' http://127.0.0.1:3000/login"
