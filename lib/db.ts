import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
export const PHOTOS_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.PHOTOS_DIR || "./photos");

export type Status = "select" | "maybe" | "reject";
export const STATUSES: Status[] = ["select", "maybe", "reject"];

const globalForDb = globalThis as unknown as { __db?: Database.Database };

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "picker.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,          -- "<album>/<file>"
      album TEXT NOT NULL,
      file TEXT NOT NULL,
      present INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS marks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      status TEXT CHECK (status IN ('select','maybe','reject')),
      note TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, photo_id)
    );
    CREATE INDEX IF NOT EXISTS marks_photo ON marks(photo_id);
    -- Preview files carry no EXIF orientation, so people fix sideways shots by hand; shared by everyone.
    CREATE TABLE IF NOT EXISTS rotations (
      photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
      deg INTEGER NOT NULL CHECK (deg IN (90, 180, 270)),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // Each selection records its folder (BRIDE, GROOM, event…) so picks can be filtered and exported per folder.
  const cols = db.prepare(`PRAGMA table_info(marks)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "album")) {
    db.exec(`ALTER TABLE marks ADD COLUMN album TEXT`);
    db.exec(`UPDATE marks SET album = (SELECT album FROM photos WHERE photos.id = marks.photo_id)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS marks_album ON marks(album, status)`);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  // Guests (signed in with GUEST_CODE) only see the shared selection and can't change anything.
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!userCols.some((c) => c.name === "is_guest")) db.exec(`ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0`);
  // Google Drive file ID of the full-resolution original (see lib/drive.ts).
  const photoCols = db.prepare(`PRAGMA table_info(photos)`).all() as { name: string }[];
  if (!photoCols.some((c) => c.name === "drive_id")) db.exec(`ALTER TABLE photos ADD COLUMN drive_id TEXT`);
  return db;
}

export function db() {
  if (!globalForDb.__db) globalForDb.__db = open();
  return globalForDb.__db;
}
