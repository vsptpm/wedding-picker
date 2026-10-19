// Reads the EXIF Orientation tag (1–8) from the first few KB of a JPEG. Returns null when absent.
export function exifOrientation(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const size = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.toString("latin1", i + 4, i + 10) === "Exif\0\0") {
      const t = i + 10;
      const le = b.toString("latin1", t, t + 2) === "II";
      const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return null;
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) return null;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return null;
    }
    if (marker === 0xda) return null; // image data reached without EXIF
    i += 2 + size;
  }
  return null;
}

/** EXIF orientation → clockwise degrees to display upright (mirrored variants treated as their rotation). */
export const ORIENT_DEG = { 1: 0, 2: 0, 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 };

/** Fetches just the start of a Drive original and returns its EXIF orientation (or null). */
export async function driveOrientation(driveId, tries = 3) {
  for (let a = 1; ; a++) {
    try {
      const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download`, {
        headers: { Range: "bytes=0-8191" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 8192);
      return exifOrientation(buf) ?? 1;
    } catch (e) {
      if (a >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * a));
    }
  }
}

/**
 * For photos linked to Drive whose orientation hasn't been read yet: read it, remember it, and set the shared
 * rotation — unless someone already rotated that photo by hand. Returns counts.
 */
export async function autoOrient(db, { concurrency = 8, onProgress } = {}) {
  const cols = db.prepare(`PRAGMA table_info(photos)`).all();
  if (!cols.some((c) => c.name === "exif_orient")) db.exec(`ALTER TABLE photos ADD COLUMN exif_orient INTEGER`);
  const todo = db.prepare(`SELECT id, drive_id FROM photos WHERE present = 1 AND drive_id IS NOT NULL AND exif_orient IS NULL`).all();
  const remember = db.prepare(`UPDATE photos SET exif_orient = ? WHERE id = ?`);
  const rotate = db.prepare(
    `INSERT INTO rotations (photo_id, deg, user_id, updated_at) VALUES (?, ?, NULL, ?) ON CONFLICT(photo_id) DO NOTHING`,
  );
  let done = 0, rotated = 0, failed = 0;
  const queue = [...todo];
  async function worker() {
    for (let p; (p = queue.shift()); ) {
      try {
        const o = await driveOrientation(p.drive_id);
        const deg = ORIENT_DEG[o] ?? 0;
        db.transaction(() => {
          remember.run(o, p.id);
          if (deg) rotated += rotate.run(p.id, deg, Date.now()).changes;
        })();
      } catch {
        failed++;
      }
      if (++done % 250 === 0) onProgress?.(done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { checked: todo.length - failed, rotated, failed };
}
