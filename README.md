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

## Deploy to Ubuntu
Needs Node 20+ and nginx on the server (`sudo apt install nginx`; Node via nodesource or nvm).
```bash
./deploy/deploy.sh user@your-server          # copies app + photos, builds, starts systemd service
ssh user@your-server 'sudo nano /opt/wedding-picker/.env.local'   # set ACCESS_CODE / ADMIN_CODE
ssh user@your-server 'sudo systemctl restart wedding-picker'
```
Then put `deploy/nginx.conf` in `/etc/nginx/sites-available/`, set your domain, and enable HTTPS
with `sudo certbot --nginx -d your-domain` — after that set `COOKIE_SECURE=1` in `.env.local`.

Back up `/srv/wedding/data/picker.db` — it holds everyone's selections.
