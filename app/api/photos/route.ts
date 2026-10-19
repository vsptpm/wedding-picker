import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureScanned } from "@/lib/photos";
import { SHARED_IDS_SQL, sharedMinVotes } from "@/lib/shared";

export const dynamic = "force-dynamic";

/** Everything the gallery needs; filtering happens client-side so it is instant. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const d = db();
  if (user.is_guest) {
    ensureScanned();
    const min = sharedMinVotes();
    const photos = d
      .prepare(
        `SELECT p.id, p.album, p.file, p.drive_id IS NOT NULL FROM photos p JOIN (${SHARED_IDS_SQL}) s ON s.photo_id = p.id
         WHERE p.present = 1 ORDER BY p.album, p.file`,
      )
      .raw()
      .all(min);
    const rotations = d
      .prepare(`SELECT r.photo_id, r.deg FROM rotations r JOIN (${SHARED_IDS_SQL}) s ON s.photo_id = r.photo_id`)
      .raw()
      .all(min);
    const me = { id: user.id, name: user.name, isAdmin: false, isGuest: true };
    if (new URL(req.url).searchParams.get("marksOnly")) return NextResponse.json({ marks: [], users: [], rotations });
    return NextResponse.json({ me, users: [], photos, marks: [], rotations });
  }
  const marks = d
    .prepare(`SELECT photo_id, user_id, status, note FROM marks`)
    .raw()
    .all() as [string, number, string | null, string | null][];
  const users = d.prepare(`SELECT id, name FROM users WHERE is_guest = 0 ORDER BY name`).all();
  const rotations = d.prepare(`SELECT photo_id, deg FROM rotations`).raw().all();
  if (new URL(req.url).searchParams.get("marksOnly")) return NextResponse.json({ marks, users, rotations });

  ensureScanned();
  const photos = d
    .prepare(`SELECT id, album, file, drive_id IS NOT NULL FROM photos WHERE present = 1 ORDER BY album, file`)
    .raw()
    .all() as [string, string, string, number][];
  return NextResponse.json({
    me: { id: user.id, name: user.name, isAdmin: !!user.is_admin, isGuest: false },
    users,
    photos,
    marks,
    rotations,
  });
}
