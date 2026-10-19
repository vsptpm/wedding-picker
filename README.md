# Wedding Photo Gallery

A private wedding gallery. Family members sign in with their name + a shared access code, browse the
photos by folder, and tap ✓ on the ones they love (☆ for maybe). Each person's picks are kept separately; the admin page
merges them and exports the final list for the photographer.

## How people use it
1. Open the site, enter your name and the access code.
2. Pick a folder (BRIDE / GROOM / eve photo …), tap a photo.
3. ✓ select · ☆ maybe · ↻ rotate (sideways photos — fixes it for everyone) · ⋯ note / download.
   Keyboard: ← → move · Space select · M maybe · R/L rotate · N note · Esc back.
   Tick "Next after select" to auto-advance.
4. Tabs filter the folder: All · Selected · Maybe · Not marked · Everyone's picks (optionally by person).

## Admin (sign in with ADMIN_CODE)
`/admin` shows each person's progress and exports the final selection:
- **CSV** — folder, file, who selected, notes
- **TXT** — filenames grouped by folder
- **Lightroom string** — paste into Library › Filter › Text › Filename › Contains

Choose "final when at least N people selected it" to narrow down a big selection.

## Branding
Set `SITE_TITLE` (e.g. `"Anshad & Subhana"`) and optionally `SITE_SUBTITLE` (e.g. `"12 October 2026 · Kochi"`)
in `.env.local`, then restart. They appear on the sign-in screen, the home page and the browser tab.

## Photos
`PHOTOS_DIR` must contain one sub-folder per album. Photos are never moved or modified;
thumbnails and rotated copies are cached in `DATA_DIR`. Added/removed photos → Admin › Rescan.

## Run locally
```bash
cp .env.example .env.local   # edit codes + PHOTOS_DIR
npm install
npm run thumbs               # optional: pre-generate thumbnails (~1 min for 7k photos)
npm run dev                  # http://localhost:3000
```

## Server (current deployment)
- Host: `trading-server` (Ubuntu 24.04, Oracle Cloud) — app in `/var/www/html/wedding-picker`, photos in `/srv/wedding/photos`,
  database + thumbnails in `/srv/wedding/data`.
- Live at **https://140.245.198.169** — systemd service `wedding-picker` on 127.0.0.1:3000 behind nginx.
  HTTP redirects to HTTPS. The certificate is a short-lived Let's Encrypt IP certificate that certbot (snap) renews
  automatically; see `deploy/nginx.conf`. Oracle Security List and iptables allow TCP 80 and 443.
- Originals: `DRIVE_FOLDER_ID` points at the photographer's Google Drive folder; `npm run drive-sync` (or Admin ›
  Sync from Google Drive) links each photo to its full-resolution original.
- Settings: `/var/www/html/wedding-picker/.env.local` (then `sudo systemctl restart wedding-picker`).

Common tasks:
```bash
./deploy/update.sh                                   # ship code changes (builds locally, copies, restarts)
rsync -a ~/path/to/NewFolder trading-server:/srv/wedding/photos/   # add photos, then Admin › Rescan
ssh trading-server 'journalctl -u wedding-picker -n 50'            # logs
scp trading-server:/srv/wedding/data/picker.db ./backup-$(date +%F).db   # back up selections
```

Setting up a fresh server: install Node 22, nginx and build-essential; copy the app and photos; `npm ci --omit=dev`;
install `deploy/wedding-picker.service` and `deploy/nginx.conf`; open TCP 80 in the cloud firewall and in iptables.
To move to a domain later: point it at the server, issue a certificate with `-d your-domain`, update the cert paths in
nginx, and keep `COOKIE_SECURE=1`.
