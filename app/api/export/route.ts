import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Row = { id: string; album: string; file: string; selects: string | null; maybes: string | null; notes: string | null; nsel: number; nmay: number };

/**
 * Final list for the photographer.
 *   min   = how many people must have Selected a photo (default 1)
 *   maybe = 1 to also count "Maybe" votes toward min
 *   format = csv | txt | lightroom
 *   folder = BRIDE&folder=GROOM … to limit to those folders (default: all)
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user?.is_admin) return new Response("forbidden", { status: 403 });
  const q = new URL(req.url).searchParams;
  const min = Math.max(1, Number(q.get("min")) || 1);
  const withMaybe = q.get("maybe") === "1";
  const format = q.get("format") || "csv";
  const folders = q.getAll("folder").filter(Boolean);

  const rows = db()
    .prepare(
      `SELECT p.id, m.album, p.file,
         group_concat(CASE WHEN m.status='select' THEN u.name END, '; ') AS selects,
         group_concat(CASE WHEN m.status='maybe' THEN u.name END, '; ') AS maybes,
         group_concat(CASE WHEN m.note IS NOT NULL THEN u.name || ': ' || m.note END, ' | ') AS notes,
         SUM(m.status='select') AS nsel, SUM(m.status='maybe') AS nmay
       FROM photos p JOIN marks m ON m.photo_id = p.id JOIN users u ON u.id = m.user_id
       ${folders.length ? `WHERE m.album IN (${folders.map(() => "?").join(",")})` : ""}
       GROUP BY p.id ORDER BY m.album, p.file`,
    )
    .all(...folders) as Row[];
  const final = rows.filter((r) => r.nsel + (withMaybe ? r.nmay : 0) >= min);
  const stamp = new Date().toISOString().slice(0, 10) + (folders.length ? "-" + folders.join("+").replace(/[^\w+-]+/g, "_") : "");

  let body: string;
  let type = "text/plain";
  let ext = "txt";
  if (format === "lightroom") {
    // Paste into Lightroom Library filter: Text › Filename › Contains (comma = OR)
    body = final.map((r) => r.file.replace(/\.[^.]+$/, "")).join(", ");
  } else if (format === "txt") {
    const byAlbum = new Map<string, string[]>();
    for (const r of final) byAlbum.set(r.album, [...(byAlbum.get(r.album) || []), r.file]);
    body = [...byAlbum].map(([a, fs]) => `== ${a} (${fs.length}) ==\n${fs.join("\n")}`).join("\n\n") + "\n";
  } else {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    body =
      ["folder,file,selected_by,maybe_by,notes"]
        .concat(final.map((r) => [r.album, r.file, r.selects, r.maybes, r.notes].map(esc).join(",")))
        .join("\n") + "\n";
    type = "text/csv";
    ext = "csv";
  }
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="wedding-selection-${stamp}-${format}.${ext}"`,
    },
  });
}
