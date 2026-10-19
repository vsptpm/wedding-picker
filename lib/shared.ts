import { db } from "./db";

/**
 * The "shared selection" guests see: photos selected by at least N family members (N set on the admin page).
 * It's computed live, so it grows as the family keeps picking.
 */
export function sharedMinVotes(): number {
  const row = db().prepare(`SELECT value FROM settings WHERE key = 'shared_min_votes'`).get() as
    | { value: string }
    | undefined;
  return Math.max(1, Number(row?.value) || 1);
}

export function setSharedMinVotes(n: number) {
  db()
    .prepare(`INSERT INTO settings (key, value) VALUES ('shared_min_votes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(String(Math.max(1, Math.min(20, Math.round(n)))));
}

/** SQL for the ids of shared photos; bind sharedMinVotes(). */
export const SHARED_IDS_SQL = `SELECT photo_id FROM marks WHERE status = 'select' GROUP BY photo_id HAVING COUNT(*) >= ?`;

export function isShared(photoId: string): boolean {
  return !!db()
    .prepare(`SELECT 1 FROM marks WHERE photo_id = ? AND status = 'select' GROUP BY photo_id HAVING COUNT(*) >= ?`)
    .get(photoId, sharedMinVotes());
}

export function sharedCount(min = sharedMinVotes()): number {
  return (db().prepare(`SELECT COUNT(*) n FROM (${SHARED_IDS_SQL}) s JOIN photos p ON p.id = s.photo_id AND p.present = 1`).get(min) as { n: number }).n;
}
