import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { STATUSES, Status, db } from "@/lib/db";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.is_guest) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json()) as { photoIds?: string[]; status?: Status | null; note?: string | null };
  const ids = Array.isArray(body.photoIds) ? body.photoIds.slice(0, 5000) : [];
  if (!ids.length) return NextResponse.json({ error: "photoIds required" }, { status: 400 });
  if (body.status != null && !STATUSES.includes(body.status))
    return NextResponse.json({ error: "bad status" }, { status: 400 });

  const d = db();
  const now = Date.now();
  const setStatus = "status" in body;
  const setNote = "note" in body;
  const note = setNote ? (body.note || "").trim().slice(0, 1000) || null : null;
  const upsert = d.prepare(`
    INSERT INTO marks (user_id, photo_id, album, status, note, updated_at)
    SELECT ?, id, album, ?, ?, ? FROM photos WHERE id = ?
    ON CONFLICT(user_id, photo_id) DO UPDATE SET
      status = CASE WHEN ? THEN excluded.status ELSE marks.status END,
      note = CASE WHEN ? THEN excluded.note ELSE marks.note END,
      album = excluded.album,
      updated_at = excluded.updated_at`);
  d.transaction(() => {
    for (const id of ids) {
      upsert.run(user.id, setStatus ? body.status ?? null : null, note, now, id, setStatus ? 1 : 0, setNote ? 1 : 0);
    }
    d.prepare(`DELETE FROM marks WHERE user_id = ? AND status IS NULL AND note IS NULL`).run(user.id);
  })();
  return NextResponse.json({ ok: true });
}
