import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { driveDownloadUrl } from "@/lib/drive";

/** Sends signed-in people straight to Google Drive for the full-resolution original. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await currentUser())) return new Response("unauthorized", { status: 401 });
  const id = (await ctx.params).path.map(decodeURIComponent).join("/");
  const row = db().prepare(`SELECT drive_id FROM photos WHERE id = ? AND present = 1`).get(id) as
    | { drive_id: string | null }
    | undefined;
  if (!row) return new Response("not found", { status: 404 });
  if (!row.drive_id) return new Response("No original is linked for this photo yet.", { status: 404 });
  return Response.redirect(driveDownloadUrl(row.drive_id), 302);
}
