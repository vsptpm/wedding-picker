import fs from "node:fs";
import { Readable } from "node:stream";
import { currentUser } from "@/lib/auth";
import { fullPath, photoPath, thumbPath } from "@/lib/photos";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await currentUser())) return new Response("unauthorized", { status: 401 });
  const id = (await ctx.params).path.map(decodeURIComponent).join("/");
  const src = photoPath(id);
  if (!src) return new Response("not found", { status: 404 });

  const q = new URL(req.url).searchParams;
  const full = q.get("size") === "full";
  const r = Number(q.get("r")) || 0;
  const deg = [90, 180, 270].includes(r) ? r : 0;
  const file = full ? await fullPath(id, src, deg) : await thumbPath(id, src, deg);
  const stat = fs.statSync(file);
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": full ? "image/jpeg" : "image/webp",
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
