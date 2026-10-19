// Pre-generates grid thumbnails so the first visit is fast.
// Usage: node --env-file=.env.local scripts/thumbs.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const PHOTOS_DIR = path.resolve(process.env.PHOTOS_DIR || "./photos");
const OUT = path.join(path.resolve(process.env.DATA_DIR || "./data"), "thumbs");
fs.mkdirSync(OUT, { recursive: true });

const jobs = [];
for (const album of fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })) {
  if (!album.isDirectory() || album.name.startsWith(".")) continue;
  for (const f of fs.readdirSync(path.join(PHOTOS_DIR, album.name))) {
    if (f.startsWith(".") || !/\.(jpe?g|png|webp|heic|tiff?)$/i.test(f)) continue;
    const out = path.join(OUT, `${album.name}__${f}.webp`);
    if (!fs.existsSync(out)) jobs.push([path.join(PHOTOS_DIR, album.name, f), out]);
  }
}
console.log(`${jobs.length} thumbnails to generate`);
let done = 0;
async function worker() {
  for (let j; (j = jobs.shift()); ) {
    const [src, out] = j;
    await sharp(src).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 }).toFile(out + ".tmp");
    fs.renameSync(out + ".tmp", out);
    if (++done % 250 === 0) console.log(done);
  }
}
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 1) }, worker));
console.log(`done (${done})`);
