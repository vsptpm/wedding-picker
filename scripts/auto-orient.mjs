// Sets each photo's rotation from its original's EXIF orientation on Google Drive (run drive-sync first).
// Manual rotations are never overwritten. Usage: node --env-file=.env.local scripts/auto-orient.mjs
import Database from "better-sqlite3";
import path from "node:path";
import { autoOrient } from "../lib/exif.mjs";

const db = new Database(path.join(path.resolve(process.env.DATA_DIR || "./data"), "picker.db"));
db.pragma("journal_mode = WAL");
const t = Date.now();
const r = await autoOrient(db, { onProgress: (d, n) => console.log(`${d}/${n}`) });
console.log(`checked ${r.checked}, newly rotated ${r.rotated}, failed ${r.failed} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
const by = db.prepare(`SELECT exif_orient o, COUNT(*) n FROM photos WHERE present = 1 GROUP BY o ORDER BY n DESC`).all();
console.log("orientation tags:", by.map((x) => `${x.o ?? "unchecked"}: ${x.n}`).join(", "));
