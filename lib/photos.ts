import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, PHOTOS_DIR, db } from "./db";

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|tiff?)$/i;

/** Walks PHOTOS_DIR (one sub-folder per album) and syncs the photos table. */
export function scanPhotos() {
  const d = db();
  const found: { id: string; album: string; file: string }[] = [];
  for (const album of fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })) {
    if (!album.isDirectory() || album.name.startsWith(".")) continue;
    for (const f of fs.readdirSync(path.join(PHOTOS_DIR, album.name))) {
      if (!f.startsWith(".") && IMAGE_EXT.test(f)) found.push({ id: `${album.name}/${f}`, album: album.name, file: f });
    }
  }
  const upsert = d.prepare(
    `INSERT INTO photos (id, album, file, present) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET present = 1`,
  );
  d.transaction(() => {
    // Keep rows for vanished files so nobody's marks are lost; just hide them.
    d.prepare(`UPDATE photos SET present = 0`).run();
    for (const p of found) upsert.run(p.id, p.album, p.file);
  })();
  return found.length;
}

export function ensureScanned() {
  const { n } = db().prepare(`SELECT COUNT(*) AS n FROM photos`).get() as { n: number };
  if (n === 0) scanPhotos();
}

/** Resolves a photo id to an absolute path, refusing anything outside PHOTOS_DIR or not in the DB. */
export function photoPath(id: string): string | null {
  const row = db().prepare(`SELECT id FROM photos WHERE id = ? AND present = 1`).get(id);
  if (!row) return null;
  const abs = path.resolve(PHOTOS_DIR, id);
  return abs.startsWith(PHOTOS_DIR + path.sep) ? abs : null;
}

const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const ROTATED_DIR = path.join(DATA_DIR, "rotated");
export const THUMB_WIDTH = 480;
const inflight = new Map<string, Promise<string>>();

function cached(out: string, make: (tmp: string) => Promise<unknown>): Promise<string> {
  if (fs.existsSync(out)) return Promise.resolve(out);
  let p = inflight.get(out);
  if (!p) {
    p = (async () => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = out + ".tmp";
      await make(tmp);
      fs.renameSync(tmp, out);
      return out;
    })().finally(() => inflight.delete(out));
    inflight.set(out, p);
  }
  return p;
}

const flat = (id: string) => id.replace(/[\\/]/g, "__");

/** Grid thumbnail, rotated by `deg` (0/90/180/270). */
export function thumbPath(id: string, src: string, deg = 0): Promise<string> {
  const out = path.join(THUMB_DIR, flat(id) + (deg ? `@${deg}` : "") + ".webp");
  return cached(out, (tmp) =>
    sharp(src)
      .rotate(deg || undefined)
      .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(tmp),
  );
}

/** Full-size image; the original file when unrotated, otherwise a cached rotated JPEG. */
export function fullPath(id: string, src: string, deg = 0): Promise<string> {
  if (!deg) return Promise.resolve(src);
  const out = path.join(ROTATED_DIR, `${flat(id)}@${deg}.jpg`);
  return cached(out, (tmp) => sharp(src).rotate(deg).jpeg({ quality: 88, mozjpeg: true }).toFile(tmp));
}
