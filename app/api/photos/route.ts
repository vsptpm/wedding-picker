import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureScanned } from "@/lib/photos";

export const dynamic = "force-dynamic";

/** Everything the gallery needs; filtering happens client-side so it is instant. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const d = db();
  const marks = d
    .prepare(`SELECT photo_id, user_id, status, note FROM marks`)
    .raw()
    .all() as [string, number, string | null, string | null][];
  const users = d.prepare(`SELECT id, name FROM users ORDER BY name`).all();
  const rotations = d.prepare(`SELECT photo_id, deg FROM rotations`).raw().all();
  if (new URL(req.url).searchParams.get("marksOnly")) return NextResponse.json({ marks, users, rotations });

  ensureScanned();
  const photos = d
    .prepare(`SELECT id, album, file FROM photos WHERE present = 1 ORDER BY album, file`)
    .raw()
    .all() as [string, string, string][];
  return NextResponse.json({
    me: { id: user.id, name: user.name, isAdmin: !!user.is_admin },
    users,
    photos,
    marks,
    rotations,
  });
}
