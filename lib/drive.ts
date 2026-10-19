import { db } from "./db";
import { autoOrient } from "./exif.mjs";

/**
 * Originals live in a link-shared Google Drive folder with one sub-folder per album (same names as PHOTOS_DIR).
 * Google's public folder view lists every file with its ID, so no API key is needed as long as the folder stays
 * shared as "Anyone with the link".
 */
export const driveFolderId = () => process.env.DRIVE_FOLDER_ID?.trim() || "";

const ENTRY = /id="entry-([\w-]+)"[\s\S]*?flip-entry-title">([^<]*)</g;

async function listFolder(id: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Drive returned ${res.status} for folder ${id}`);
  const html = await res.text();
  const decode = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return [...html.matchAll(ENTRY)].map((m) => ({ id: m[1], name: decode(m[2]).trim() }));
}

/** Matches every photo to its original on Drive by folder + file name. */
export async function syncDrive() {
  const root = driveFolderId();
  if (!root) throw new Error("DRIVE_FOLDER_ID is not set");
  const albums = await listFolder(root);
  const d = db();
  const update = d.prepare(`UPDATE photos SET drive_id = ? WHERE album = ? AND file = ?`);
  let matched = 0;
  let seen = 0;
  for (const album of albums) {
    const files = await listFolder(album.id);
    d.transaction(() => {
      for (const f of files) {
        seen++;
        matched += update.run(f.id, album.name, f.name).changes;
      }
    })();
  }
  const { missing } = d
    .prepare(`SELECT COUNT(*) missing FROM photos WHERE present = 1 AND drive_id IS NULL`)
    .get() as { missing: number };
  // Read the camera's orientation for newly linked photos so sideways shots show upright (manual rotations win).
  const orient = await autoOrient(d);
  return { folders: albums.length, driveFiles: seen, matched, missing, rotated: orient.rotated };
}

export const driveDownloadUrl = (id: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download`;
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
