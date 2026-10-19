// Pre-generates grid thumbnails (including rotated ones) so the first visit is fast.
// Usage: node --env-file=.env.local scripts/thumbs.mjs
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const PHOTOS_DIR = path.resolve(process.env.PHOTOS_DIR || "./photos");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const OUT = path.join(DATA_DIR, "thumbs");
fs.mkdirSync(OUT, { recursive: true });

// Shared rotations (manual or from EXIF) — thumbnails for those are cached as "<name>@<deg>.webp".
const rotations = new Map();
const dbFile = path.join(DATA_DIR, "picker.db");
if (fs.existsSync(dbFile)) {
  const db = new Database(dbFile, { readonly: true });
  for (const r of db.prepare(`SELECT photo_id, deg FROM rotations`).all()) rotations.set(r.photo_id, r.deg);
  db.close();
}

const jobs = [];
for (const album of fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })) {
  if (!album.isDirectory() || album.name.startsWith(".")) continue;
  for (const f of fs.readdirSync(path.join(PHOTOS_DIR, album.name))) {
    if (f.startsWith(".") || !/\.(jpe?g|png|webp|heic|tiff?)$/i.test(f)) continue;
    const deg = rotations.get(`${album.name}/${f}`) || 0;
    const out = path.join(OUT, `${album.name}__${f}${deg ? `@${deg}` : ""}.webp`);
    if (!fs.existsSync(out)) jobs.push([path.join(PHOTOS_DIR, album.name, f), out, deg]);
  }
}
console.log(`${jobs.length} thumbnails to generate`);
let done = 0;
async function worker() {
  for (let j; (j = jobs.shift()); ) {
    const [src, out, deg] = j;
    await sharp(src)
      .rotate(deg || undefined)
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(out + ".tmp");
    fs.renameSync(out + ".tmp", out);
    if (++done % 250 === 0) console.log(done);
  }
}
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 1) }, worker));
console.log(`done (${done})`);
