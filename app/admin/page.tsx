import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureScanned, scanPhotos } from "@/lib/photos";
import { siteTitle } from "@/lib/site";
import { driveFolderId, syncDrive } from "@/lib/drive";
import Icon from "../Icon";

export const dynamic = "force-dynamic";

async function rescan() {
  "use server";
  if (!(await currentUser())?.is_admin) return;
  scanPhotos();
  revalidatePath("/admin");
}

const label = (a: string) => a.toLowerCase().replace(/(^|\s|[-_])\p{L}/gu, (c) => c.toUpperCase());
const fmt = (n: number) => n.toLocaleString("en-IN");
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function ago(ts: number | null) {
  if (!ts) return "—";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

async function syncOriginals() {
  "use server";
  if (!(await currentUser())?.is_admin) return;
  let q: string;
  try {
    const r = await syncDrive();
    q = `synced=${r.matched}&missing=${r.missing}`;
  } catch (e) {
    q = `syncError=${encodeURIComponent(e instanceof Error ? e.message : "Sync failed")}`;
  }
  revalidatePath("/admin");
  redirect(`/admin?${q}#originals`);
}

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ synced?: string; missing?: string; syncError?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.is_admin) redirect("/");
  ensureScanned();
  const d = db();
  const total = (d.prepare(`SELECT COUNT(*) n FROM photos WHERE present = 1`).get() as { n: number }).n;
  const people = d
    .prepare(
      `SELECT u.id, u.name, u.is_admin,
         COALESCE(SUM(m.status='select'),0) sel, COALESCE(SUM(m.status='maybe'),0) may,
         COALESCE(SUM(m.status IS NOT NULL),0) seen, COALESCE(SUM(m.note IS NOT NULL),0) notes,
         MAX(m.updated_at) last
       FROM users u LEFT JOIN marks m ON m.user_id = u.id GROUP BY u.id ORDER BY sel DESC, u.name`,
    )
    .all() as { id: number; name: string; is_admin: number; sel: number; may: number; seen: number; notes: number; last: number | null }[];
  const votes = d
    .prepare(
      `SELECT n, COUNT(*) photos FROM (SELECT COUNT(*) n FROM marks WHERE status='select' GROUP BY photo_id) GROUP BY n ORDER BY n`,
    )
    .all() as { n: number; photos: number }[];
  const byAlbum = d
    .prepare(
      `SELECT p.album, COUNT(DISTINCT p.id) total,
         COUNT(DISTINCT CASE WHEN m.status='select' THEN p.id END) picked
       FROM photos p LEFT JOIN marks m ON m.photo_id = p.id WHERE p.present = 1 GROUP BY p.album ORDER BY p.album`,
    )
    .all() as { album: string; total: number; picked: number }[];
  const perFolder = d
    .prepare(
      `SELECT m.user_id, m.album, SUM(m.status='select') sel, SUM(m.status='maybe') may
       FROM marks m GROUP BY m.user_id, m.album`,
    )
    .all() as { user_id: number; album: string; sel: number; may: number }[];
  const linked = (d.prepare(`SELECT COUNT(*) n FROM photos WHERE present = 1 AND drive_id IS NOT NULL`).get() as { n: number }).n;
  const notes = (d.prepare(`SELECT COUNT(*) n FROM marks WHERE note IS NOT NULL`).get() as { n: number }).n;
  const cell = (uid: number, album: string) => perFolder.find((r) => r.user_id === uid && r.album === album);
  const atLeast = (k: number) => votes.filter((v) => v.n >= k).reduce((a, v) => a + v.photos, 0);
  const maxVotes = Math.max(1, Math.min(5, people.length));

  return (
    <main className="admin">
      <a href="/" className="back-link">
        <Icon name="arrow-left" size={16} /> Back to gallery
      </a>
      <header className="admin-head">
        <p className="eyebrow">{siteTitle()}</p>
        <h1 className="display">Selection summary</h1>
        <p>Track everyone&apos;s progress and export the final list for the photographer.</p>
      </header>

      <section className="kpis">
        <div className="kpi">
          <span>Photos</span>
          <strong>{fmt(total)}</strong>
        </div>
        <div className="kpi">
          <span>Picked by anyone</span>
          <strong>{fmt(atLeast(1))}</strong>
        </div>
        <div className="kpi">
          <span>Picked by 2+</span>
          <strong>{fmt(atLeast(2))}</strong>
        </div>
        <div className="kpi">
          <span>People</span>
          <strong>{people.length}</strong>
        </div>
        <div className="kpi">
          <span>Notes</span>
          <strong>{fmt(notes)}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Export for the photographer</h2>
          <p>Choose which photos count as final, then download the list.</p>
        </div>
        <form action="/api/export" method="get" className="panel-body export-form">
          <div className="export-row">
            <span>A photo is final when it&apos;s selected by at least</span>
            <div className="check-row">
              {Array.from({ length: maxVotes }, (_, i) => i + 1).map((n) => (
                <label key={n} className="check-pill">
                  <input type="radio" name="min" value={n} defaultChecked={n === 1} />
                  <span>
                    {n} {n === 1 ? "person" : "people"} <em>{fmt(atLeast(n))}</em>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="export-row">
            <span>Folders · leave all unticked to include every folder</span>
            <div className="check-row">
              {byAlbum.map((a) => (
                <label key={a.album} className="check-pill">
                  <input type="checkbox" name="folder" value={a.album} />
                  <span>
                    {label(a.album)} <em>{fmt(a.picked)}</em>
                  </span>
                </label>
              ))}
              <label className="check-pill">
                <input type="checkbox" name="maybe" value="1" />
                <span>Count “Maybe” as a vote</span>
              </label>
            </div>
          </div>
          <div className="export-actions">
            <button name="format" value="csv" className="btn btn-primary">
              <Icon name="download" size={17} /> Spreadsheet (CSV)
            </button>
            <button name="format" value="txt" className="btn">
              File list (.txt)
            </button>
            <button name="format" value="lightroom" className="btn">
              Lightroom filter
            </button>
          </div>
          <p className="hint">
            The spreadsheet includes who selected each photo and any notes. For Lightroom, paste the text into Library ›
            Filter › Text › Filename › Contains.
          </p>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>People</h2>
          <p>Everyone who has signed in, and how far they&apos;ve got.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Selected</th>
                <th className="num">Maybe</th>
                <th>Reviewed</th>
                <th className="num">Notes</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const pct = total ? (p.seen / total) * 100 : 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="person">
                        <span
                          className="avatar"
                          style={{ width: 28, height: 28, fontSize: 11, ["--h" as string]: hue(p.name) }}
                        >
                          {initials(p.name)}
                        </span>
                        {p.name}
                        {p.is_admin ? <span className="badge">Admin</span> : null}
                      </span>
                    </td>
                    <td className="num">{fmt(p.sel)}</td>
                    <td className="num">{fmt(p.may)}</td>
                    <td>
                      <span className="mini-progress">
                        <span className="progress">
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        <span className="muted">{pct < 1 && p.seen > 0 ? "<1" : Math.round(pct)}%</span>
                      </span>
                    </td>
                    <td className="num">{fmt(p.notes)}</td>
                    <td className="muted">{ago(p.last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>By folder</h2>
          <p>Photos each person selected in every folder. Maybes in brackets.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                {byAlbum.map((a) => (
                  <th key={a.album} className="num">
                    {label(a.album)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  {byAlbum.map((a) => {
                    const c = cell(p.id, a.album);
                    return (
                      <td key={a.album} className="num">
                        {fmt(c?.sel ?? 0)}
                        {c?.may ? <span className="sub">({c.may})</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="total">
                <td>Picked by anyone</td>
                {byAlbum.map((a) => (
                  <td key={a.album} className="num">
                    {fmt(a.picked)}
                    <span className="sub">/ {fmt(a.total)}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" id="originals">
        <div className="panel-head">
          <h2>Originals on Google Drive</h2>
          <p>
            {fmt(linked)} of {fmt(total)} photos are linked to their full-resolution original, so &ldquo;Download
            original&rdquo; works for them.
          </p>
        </div>
        <form action={syncOriginals} className="panel-body sync-row">
          <button className="btn" disabled={!driveFolderId()}>
            Sync from Google Drive
          </button>
          {sp.synced != null && (
            <span className="hint">
              Linked {fmt(Number(sp.synced))} photos
              {Number(sp.missing) > 0 ? ` · ${fmt(Number(sp.missing))} have no matching original on Drive` : " · all matched"}
            </span>
          )}
          {sp.syncError && <span className="hint error-text">{sp.syncError}</span>}
          {!driveFolderId() && <span className="hint">Set DRIVE_FOLDER_ID in .env.local to enable.</span>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Photo library</h2>
          <p>Added or removed photos on the server? Rescan to update the gallery. Selections are kept.</p>
        </div>
        <form action={rescan} className="panel-body">
          <button className="btn">Rescan photos</button>
        </form>
      </section>
    </main>
  );
}
