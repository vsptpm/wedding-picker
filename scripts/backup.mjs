// Nightly snapshot of the database (picks, notes, rotations, people) — safe while the site is in use.
// Keeps the most recent 14. Usage: node --env-file=.env.local scripts/backup.mjs
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const DIR = path.join(path.dirname(DATA_DIR), "backups");
const KEEP = 14;
fs.mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = path.join(DIR, `picker-${stamp}.db`);
const db = new Database(path.join(DATA_DIR, "picker.db"), { readonly: true });
await db.backup(out);
db.close();
const check = new Database(out, { readonly: true });
const ok = check.prepare("PRAGMA integrity_check").get().integrity_check;
const users = check.prepare("SELECT COUNT(*) n FROM users").get().n;
check.close();
for (const ext of ["-shm", "-wal"]) fs.rmSync(out + ext, { force: true });
if (ok !== "ok") throw new Error(`backup failed integrity check: ${ok}`);
const old = fs.readdirSync(DIR).filter((f) => /^picker-.*\.db$/.test(f)).sort().slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(DIR, f));
console.log(`${new Date().toISOString()} backup ok → ${out} (${users} people, removed ${old.length} old)`);
