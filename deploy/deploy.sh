#!/usr/bin/env bash
# Copies the app + photos to the Ubuntu server and (re)starts it.
# Usage: ./deploy/deploy.sh user@server [/path/to/local/photos]
set -euo pipefail
SERVER="${1:?usage: deploy.sh user@server [photos_dir]}"
PHOTOS="${2:-$HOME/Downloads/Wedding_Selection_Previews}"
APP=/opt/wedding-picker

ssh "$SERVER" "sudo mkdir -p $APP /srv/wedding/photos && sudo chown -R \$USER $APP /srv/wedding"
rsync -az --delete --exclude node_modules --exclude .next --exclude data --exclude .env.local ./ "$SERVER:$APP/"
rsync -az --info=progress2 --exclude .DS_Store "$PHOTOS/" "$SERVER:/srv/wedding/photos/"
ssh "$SERVER" bash -s <<REMOTE
set -e
cd $APP
[ -f .env.local ] || { sed -e 's#^PHOTOS_DIR=.*#PHOTOS_DIR=/srv/wedding/photos#' -e 's#^DATA_DIR=.*#DATA_DIR=/srv/wedding/data#' .env.example > .env.local; echo ">> created .env.local — edit ACCESS_CODE / ADMIN_CODE!"; }
npm ci && npm run build
mkdir -p /srv/wedding/data
sudo chown -R www-data:www-data /srv/wedding/data
sudo -u www-data env \$(grep -v '^#' .env.local | xargs) node scripts/thumbs.mjs
sudo cp deploy/wedding-picker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wedding-picker && sudo systemctl restart wedding-picker
REMOTE
echo "Deployed. Check: ssh $SERVER 'systemctl status wedding-picker'"
