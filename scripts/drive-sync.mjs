// Links every photo to its full-resolution original in the shared Google Drive folder (by folder + file name).
// Same as Admin › Sync from Google Drive. Usage: node --env-file=.env.local scripts/drive-sync.mjs
import Database from "better-sqlite3";
import path from "node:path";

const root = process.env.DRIVE_FOLDER_ID;
if (!root) throw new Error("DRIVE_FOLDER_ID is not set");
const db = new Database(path.join(path.resolve(process.env.DATA_DIR || "./data"), "picker.db"));
if (!db.prepare(`PRAGMA table_info(photos)`).all().some((c) => c.name === "drive_id"))
  db.exec(`ALTER TABLE photos ADD COLUMN drive_id TEXT`);

const ENTRY = /id="entry-([\w-]+)"[\s\S]*?flip-entry-title">([^<]*)</g;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function list(id) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}`);
  if (!res.ok) throw new Error(`Drive returned ${res.status}`);
  return [...(await res.text()).matchAll(ENTRY)].map((m) => ({ id: m[1], name: decode(m[2]).trim() }));
}

const update = db.prepare(`UPDATE photos SET drive_id = ? WHERE album = ? AND file = ?`);
let matched = 0;
for (const album of await list(root)) {
  const files = await list(album.id);
  db.transaction(() => files.forEach((f) => (matched += update.run(f.id, album.name, f.name).changes)))();
  console.log(`${album.name}: ${files.length} on Drive`);
}
const { missing } = db.prepare(`SELECT COUNT(*) missing FROM photos WHERE present = 1 AND drive_id IS NULL`).get();
console.log(`linked ${matched} photos, ${missing} without an original`);
