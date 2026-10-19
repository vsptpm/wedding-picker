import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** Sets the shared rotation for photos (deg 0 clears it). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.is_guest) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { photoIds, deg } = (await req.json()) as { photoIds?: string[]; deg?: number };
  const ids = Array.isArray(photoIds) ? photoIds.slice(0, 5000) : [];
  if (!ids.length || ![0, 90, 180, 270].includes(deg as number))
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  const d = db();
  const set = d.prepare(`
    INSERT INTO rotations (photo_id, deg, user_id, updated_at) SELECT id, ?, ?, ? FROM photos WHERE id = ?
    ON CONFLICT(photo_id) DO UPDATE SET deg = excluded.deg, user_id = excluded.user_id, updated_at = excluded.updated_at`);
  const clear = d.prepare(`DELETE FROM rotations WHERE photo_id = ?`);
  d.transaction(() => {
    for (const id of ids) deg ? set.run(deg, user.id, Date.now(), id) : clear.run(id);
  })();
  return NextResponse.json({ ok: true });
}
