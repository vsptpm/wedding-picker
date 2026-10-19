"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

type Status = "select" | "maybe";
type Mark = { status: Status | null; note: string | null };
type Photo = { id: string; album: string; file: string; original: boolean };
type UserRow = { id: number; name: string };
type Me = { id: number; name: string; isAdmin: boolean; isGuest: boolean };
type MarkRow = [string, number, Status | null, string | null];
type Marks = Map<string, Map<number, Mark>>;
type Rotations = Map<string, number>;
type Density = "s" | "m" | "l";

type Tab = "all" | "mine" | "maybe" | "unseen" | "team";
const TABS: { key: Tab; label: string; short: string }[] = [
  { key: "all", label: "All photos", short: "All" },
  { key: "mine", label: "My selection", short: "Selected" },
  { key: "maybe", label: "Maybe", short: "Maybe" },
  { key: "unseen", label: "Not reviewed", short: "To review" },
  { key: "team", label: "Family picks", short: "Family" },
];
const ALL = "*"; // pseudo-album: every folder

/** Target row height for the justified photo grid at each thumbnail size. */
const ROW_H: Record<Density, string> = {
  s: "min(120px, 19vw)",
  m: "min(210px, 28vw)",
  l: "min(330px, 52vw)",
};
const DENSITY: Record<Density, string> = {
  s: "min(136px, 23vw)",
  m: "min(220px, 31vw)",
  l: "min(340px, 46vw)",
};

type Route =
  | { view: "home" }
  | { view: "album"; album: string; tab: Tab; who: number | null }
  | { view: "photo"; album: string; tab: Tab; who: number | null; file: string };

function parseHash(): Route {
  const [path, qs] = (typeof window === "undefined" ? "" : window.location.hash.slice(1)).split("?");
  let parts: string[];
  try {
    parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { view: "home" }; // truncated or mangled link
  }
  const q = new URLSearchParams(qs);
  const tab = (TABS.some((t) => t.key === q.get("tab")) ? q.get("tab") : "all") as Tab;
  const who = q.get("who") ? Number(q.get("who")) : null;
  if (parts[0] === "album" && parts[1]) {
    if (parts[2]) return { view: "photo", album: parts[1], tab, who, file: parts[2] };
    return { view: "album", album: parts[1], tab, who };
  }
  return { view: "home" };
}

function hashFor(r: Route): string {
  if (r.view === "home") return "#/";
  const q = new URLSearchParams();
  if (r.tab !== "all") q.set("tab", r.tab);
  if (r.tab === "team" && r.who != null) q.set("who", String(r.who));
  const qs = q.toString() ? `?${q}` : "";
  const base = `#/album/${encodeURIComponent(r.album)}`;
  return r.view === "photo" ? `${base}/${encodeURIComponent(r.file)}${qs}` : `${base}${qs}`;
}

const imgUrl = (p: Photo, deg = 0, full = false) => {
  const q = new URLSearchParams();
  if (full) q.set("size", "full");
  if (deg) q.set("r", String(deg));
  const qs = q.toString();
  return `/api/img/${encodeURIComponent(p.album)}/${encodeURIComponent(p.file)}${qs ? `?${qs}` : ""}`;
};
const isSideways = (deg = 0) => deg === 90 || deg === 270;
/** Full-resolution original, served from Google Drive via a signed-in redirect. */
const originalUrl = (p: Photo) => `/api/original/${encodeURIComponent(p.album)}/${encodeURIComponent(p.file)}`;

/** "BRIDE" → "Bride", "eve photo" → "Eve Photo". */
const label = (album: string) =>
  album === ALL ? "All folders" : album.toLowerCase().replace(/(^|\s|[-_])\p{L}/gu, (c) => c.toUpperCase());
const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

function initials(name: string) {
  // Letters only: "Anu (guest)" → "A", not "A(".
  const parts = name.replace(/\([^)]*\)/g, "").replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "G";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, ["--h" as string]: hue(name) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

function buildMarks(rows: MarkRow[]): Marks {
  const m: Marks = new Map();
  for (const [pid, uid, status, note] of rows) {
    if (!m.has(pid)) m.set(pid, new Map());
    m.get(pid)!.set(uid, { status, note });
  }
  return m;
}

function store<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Closes a popover when clicking outside it or pressing Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);
  return ref;
}

export default function Gallery({ title, subtitle }: { title: string; subtitle: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [marks, setMarks] = useState<Marks>(new Map());
  const [rotations, setRotations] = useState<Rotations>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ view: "home" });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    fetch("/api/photos")
      .then((r) => {
        if (r.status === 401) window.location.href = "/login";
        return r.json();
      })
      .then((d) => {
        setMe(d.me);
        setUsers(d.users);
        setPhotos(
          (d.photos as [string, string, string, number][]).map(([id, album, file, orig]) => ({
            id,
            album,
            file,
            original: !!orig,
          })),
        );
        setMarks(buildMarks(d.marks));
        setRotations(new Map(d.rotations));
      })
      .catch(() => setError("We couldn't load the gallery. Check your connection and refresh."));
  }, []);

  // Pull everyone else's picks every 20s so the family view stays fresh (paused while the tab is hidden).
  // `version` bumps on every local change; a refresh that started before a change is discarded, so it can't briefly
  // undo something you just did.
  useEffect(() => {
    if (!me) return;
    const t = setInterval(async () => {
      if (pending.current > 0 || document.hidden) return;
      const startedAt = version.current;
      try {
        const r = await fetch("/api/photos?marksOnly=1");
        if (r.status === 401) return signedOut();
        const d = await r.json();
        if (pending.current > 0 || version.current !== startedAt) return;
        const sig = JSON.stringify([d.marks, d.rotations, d.users]);
        if (sig === lastSync.current) return; // nothing changed: don't redraw thousands of tiles
        lastSync.current = sig;
        setUsers(d.users);
        setMarks(buildMarks(d.marks));
        setRotations(new Map(d.rotations));
      } catch {}
    }, 20000);
    return () => clearInterval(t);
  }, [me]);

  const pending = useRef(0);
  const version = useRef(0);
  const lastSync = useRef("");
  /** The session ended (signed out elsewhere, or the access code changed): go to sign-in instead of failing silently. */
  const signedOut = useCallback(() => {
    window.location.href = "/login";
  }, []);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const rotationsRef = useRef(rotations);
  rotationsRef.current = rotations;

  const save = useCallback(
    async (pids: string[], patch: Partial<Mark>) => {
      if (!me) return;
      version.current++;
      const before = new Map(pids.map((pid) => [pid, marksRef.current.get(pid)]));
      const apply = (m: Marks, compute: (pid: string, cur: Map<number, Mark> | undefined) => Map<number, Mark> | undefined) => {
        const next: Marks = new Map(m);
        for (const pid of pids) {
          const v = compute(pid, next.get(pid));
          if (v) next.set(pid, v);
          else next.delete(pid);
        }
        return (marksRef.current = next);
      };
      setMarks((m) =>
        apply(m, (_, cur) => {
          const inner = new Map(cur || []);
          const upd = { ...(inner.get(me.id) || { status: null, note: null }), ...patch };
          if (upd.status == null && !upd.note) inner.delete(me.id);
          else inner.set(me.id, upd);
          return inner;
        }),
      );
      pending.current++;
      try {
        const r = await fetch("/api/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: pids, ...patch }),
        });
        if (r.status === 401) return signedOut();
        if (!r.ok) throw new Error();
      } catch {
        setMarks((m) => apply(m, (pid) => before.get(pid)));
        notify("That change didn't save. Check your connection and try again.");
      } finally {
        pending.current--;
      }
    },
    [me, notify],
  );

  // Rotation is shared: fixing a sideways photo fixes it for everyone.
  const rotate = useCallback(
    async (pid: string, delta: number) => {
      version.current++;
      const old = rotationsRef.current.get(pid) || 0;
      const deg = (((old + delta) % 360) + 360) % 360;
      const setDeg = (d: number) => {
        const next = new Map(rotationsRef.current);
        if (d) next.set(pid, d);
        else next.delete(pid);
        setRotations((rotationsRef.current = next));
      };
      setDeg(deg);
      pending.current++;
      try {
        const r = await fetch("/api/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: [pid], deg }),
        });
        if (r.status === 401) return signedOut();
        if (!r.ok) throw new Error();
      } catch {
        setDeg(old);
        notify("The rotation didn't save. Try again.");
      } finally {
        pending.current--;
      }
    },
    [notify],
  );

  const albums = useMemo(() => [...new Set(photos.map((p) => p.album))], [photos]);
  const mySelected = useMemo(
    () => (me ? photos.filter((p) => marks.get(p.id)?.get(me.id)?.status === "select").length : 0),
    [photos, marks, me],
  );

  const go = useCallback((r: Route, replace = false) => {
    if (replace) window.location.replace(hashFor(r));
    else window.location.hash = hashFor(r);
  }, []);

  if (error)
    return (
      <div className="splash">
        <p className="wordmark">{title}</p>
        <p className="muted">{error}</p>
        <button className="btn" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!me) return <LoadingSkeleton title={title} route={route} />;
  // Guests see one gallery of the shared selection; "home" for them is that gallery.
  const albumRoute: Extract<Route, { view: "album" | "photo" }> =
    route.view === "home" ? { view: "album", album: ALL, tab: "all", who: null } : me.isGuest ? { ...route, tab: "all", who: null } : route;

  return (
    <>
      <AppBar title={title} route={route} me={me} mySelected={mySelected} go={go} />

      {route.view === "home" && !me.isGuest ? (
        <Home
          title={title}
          subtitle={subtitle}
          albums={albums}
          photos={photos}
          marks={marks}
          rotations={rotations}
          me={me}
          users={users}
          go={go}
        />
      ) : (
        <AlbumView
          key={`${albumRoute.album}|${albumRoute.tab}|${albumRoute.who}`}
          route={albumRoute}
          title={title}
          subtitle={subtitle}
          albums={albums}
          photos={photos}
          marks={marks}
          rotations={rotations}
          me={me}
          users={users}
          save={save}
          rotate={rotate}
          go={go}
        />
      )}

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}

/* -------------------------------- Skeletons ------------------------------- */

/** Fades an image in once it has loaded; until then its container shows a shimmer. */
const markLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add("is-loaded");

const Bone = ({ w, h, r, className = "" }: { w?: number | string; h: number | string; r?: number; className?: string }) => (
  <span className={`skel ${className}`} style={{ width: w ?? "100%", height: h, borderRadius: r }} aria-hidden />
);

/** Layout-shaped placeholder shown while the gallery data loads — matches the page you're about to see. */
function LoadingSkeleton({ title, route }: { title: string; route: Route }) {
  const inAlbum = route.view !== "home";
  return (
    <div aria-busy="true" aria-label="Loading gallery">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="appbar-left">
            {inAlbum ? <Bone w={180} h={18} r={6} /> : <span className="wordmark sm">{title}</span>}
          </div>
          <div className="appbar-right">
            <Bone w={96} h={34} r={999} />
            <Bone w={34} h={34} r={999} />
          </div>
        </div>
      </header>
      {inAlbum ? (
        <main className="album">
          <section className="page-head skel-center">
            <Bone w={70} h={11} r={4} />
            <Bone w="min(280px, 70%)" h={52} r={10} />
            <Bone w="min(320px, 80%)" h={14} r={6} />
          </section>
          <div className="toolbar">
            <div className="toolbar-inner skel-toolbar">
              <div className="skel-row">
                {[92, 110, 70, 104, 96].map((w, i) => (
                  <Bone key={i} w={w} h={16} r={6} />
                ))}
              </div>
              <Bone w={200} h={36} r={999} className="hide-sm" />
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${DENSITY.m}, 1fr))` }}>
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="tile skel" style={{ animationDelay: `${(i % 6) * 60}ms` }} />
            ))}
          </div>
        </main>
      ) : (
        <main className="home">
          <section className="hero skel-center">
            <Bone w="min(420px, 80%)" h={64} r={12} />
            <Bone w="min(460px, 90%)" h={16} r={6} />
            <Bone w="min(340px, 70%)" h={16} r={6} />
            <Bone w={190} h={44} r={999} />
          </section>
          <div className="stats skel-stats">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skel-center">
                <Bone w={84} h={11} r={4} />
                <Bone w={56} h={34} r={8} />
              </div>
            ))}
          </div>
          <div className="folder-grid">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="folder-card">
                <span className="folder-cover skel" style={{ display: "block" }} />
                <div className="folder-meta">
                  <Bone h={3} r={3} />
                  <div className="folder-meta-row">
                    <Bone w={90} h={13} r={5} />
                    <Bone w={70} h={13} r={5} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

/* --------------------------------- App bar -------------------------------- */

function AppBar({
  title,
  route,
  me,
  mySelected,
  go,
}: {
  title: string;
  route: Route;
  me: Me;
  mySelected: number;
  go: (r: Route, replace?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const menuRef = useDismiss(open, close);
  const inAlbum = route.view !== "home";

  return (
    <header className="appbar">
      <div className="appbar-inner">
        <div className="appbar-left">
          {inAlbum && !(me.isGuest && route.album === ALL) ? (
            <>
              <button className="icon-btn" aria-label="Back to gallery" onClick={() => go({ view: "home" })}>
                <Icon name="arrow-left" />
              </button>
              <nav className="crumbs" aria-label="Breadcrumb">
                <a href="#/">{title}</a>
                <Icon name="chevron-right" size={14} />
                <span aria-current="page">{label(route.album)}</span>
              </nav>
            </>
          ) : me.isGuest ? null : (
            <a className="wordmark sm" href="#/">
              {title}
            </a>
          )}
        </div>
        <div className="appbar-right">
          {!me.isGuest && (
          <button
            className="sel-counter"
            onClick={() => go({ view: "album", album: ALL, tab: "mine", who: null })}
            title="View my selection"
          >
            <Icon name="check" size={15} strokeWidth={2.25} />
            <span className="num">{fmt(mySelected)}</span>
            <span className="lbl">selected</span>
          </button>
          )}
          <div className="popover-anchor" ref={menuRef}>
            <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account">
              <Avatar name={me.name} size={34} />
            </button>
            {open && (
              <div className="popover" role="menu">
                <div className="popover-head">
                  <Avatar name={me.name} size={36} />
                  <div>
                    <strong>{me.name}</strong>
                    <span>{me.isAdmin ? "Admin" : me.isGuest ? "Guest" : "Family"}</span>
                  </div>
                </div>
                {me.isAdmin && (
                  <a href="/admin" role="menuitem">
                    <Icon name="chart" size={18} /> Summary &amp; export
                  </a>
                )}
                <form action="/api/logout" method="post">
                  <button type="submit" role="menuitem">
                    <Icon name="log-out" size={18} /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------- Home ---------------------------------- */

function Home({
  title,
  subtitle,
  albums,
  photos,
  marks,
  rotations,
  me,
  users,
  go,
}: {
  title: string;
  subtitle: string;
  albums: string[];
  photos: Photo[];
  marks: Marks;
  rotations: Rotations;
  me: Me;
  users: UserRow[];
  go: (r: Route) => void;
}) {
  const stats = useMemo(() => {
    const s = new Map<string, { total: number; mine: number; maybe: number; seen: number; team: number; cover?: Photo }>();
    for (const a of [ALL, ...albums]) s.set(a, { total: 0, mine: 0, maybe: 0, seen: 0, team: 0 });
    for (const p of photos) {
      const m = marks.get(p.id);
      const mine = m?.get(me.id)?.status;
      const team = m ? [...m.values()].some((x) => x.status === "select") : false;
      for (const k of [ALL, p.album]) {
        const t = s.get(k)!;
        t.total++;
        if (mine === "select") t.mine++;
        if (mine === "maybe") t.maybe++;
        if (mine) t.seen++;
        if (team) t.team++;
      }
    }
    // A cover from a little way into each folder — the first frames are often test shots.
    for (const a of albums) {
      const inAlbum = photos.filter((p) => p.album === a);
      s.get(a)!.cover = inAlbum[Math.floor(inAlbum.length * 0.18)];
    }
    return s;
  }, [albums, photos, marks, me.id]);
  const all = stats.get(ALL)!;
  const pct = all.total ? Math.round((all.seen / all.total) * 100) : 0;
  const firstName = me.name.split(/\s+/)[0];
  const resume = albums.find((a) => stats.get(a)!.seen < stats.get(a)!.total);

  return (
    <main className="home">
      <section className="hero">
        {subtitle && <p className="eyebrow">{subtitle}</p>}
        <h1 className="display">{title}</h1>
        <p className="lede">
          {all.mine === 0
            ? `Welcome, ${firstName}. Browse the photos by folder, and tap the check on any you love to save it to your selection.`
            : `Welcome back, ${firstName}. You have ${plural(all.mine, "photo")} in your selection.`}
        </p>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            onClick={() => go({ view: "album", album: resume ?? albums[0] ?? ALL, tab: "all", who: null })}
          >
            View the gallery
            <Icon name="arrow-right" size={18} />
          </button>
          {all.mine > 0 && (
            <button className="btn" onClick={() => go({ view: "album", album: ALL, tab: "mine", who: null })}>
              My selection
            </button>
          )}
        </div>
      </section>

      <dl className="stats">
        <div>
          <dt>My selection</dt>
          <dd>{fmt(all.mine)}</dd>
        </div>
        <div>
          <dt>Maybe</dt>
          <dd>{fmt(all.maybe)}</dd>
        </div>
        <button className="stat-link" onClick={() => go({ view: "album", album: ALL, tab: "team", who: null })}>
          <dt>Family picks</dt>
          <dd>
            {fmt(all.team)}
            <span className="stat-sub">
              <Icon name="users" size={14} /> {users.length}
            </span>
          </dd>
        </button>
        <div>
          <dt>Reviewed</dt>
          <dd>
            {pct}
            <small>%</small>
          </dd>
        </div>
      </dl>

      <section>
        <div className="section-head">
          <h2>Folders</h2>
          <span className="muted">{plural(all.total, "photo")}</span>
        </div>
        <div className="folder-grid">
          {albums.map((a) => {
            const s = stats.get(a)!;
            const done = s.total ? s.seen / s.total : 0;
            return (
              <button key={a} className="folder-card" onClick={() => go({ view: "album", album: a, tab: "all", who: null })}>
                <div className="folder-cover">
                  {s.cover && (
                    <img
                      src={imgUrl(s.cover, rotations.get(s.cover.id))}
                      alt=""
                      loading="lazy"
                      onLoad={markLoaded}
                    />
                  )}
                  <div className="folder-cover-text">
                    <h3>{label(a)}</h3>
                    <span>{plural(s.total, "photo")}</span>
                  </div>
                </div>
                <div className="folder-meta">
                  <div className="progress" aria-label={`${Math.round(done * 100)}% reviewed`}>
                    <span style={{ width: `${done * 100}%` }} />
                  </div>
                  <div className="folder-meta-row">
                    <span>
                      <strong>{fmt(s.mine)}</strong> selected
                    </span>
                    <span className="muted">
                      {s.seen === 0 ? "Not started" : done === 1 ? "Complete" : `${Math.round(done * 100)}% reviewed`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

/* ---------------------------------- Album --------------------------------- */

const EMPTY: Record<Tab, { title: string; body: string }> = {
  all: { title: "No photos here", body: "This folder is empty." },
  mine: { title: "Nothing selected yet", body: "Tap the check on any photo to add it to your selection." },
  maybe: { title: "No maybes", body: "Use the star to set aside photos you want to decide on later." },
  unseen: { title: "All caught up", body: "You've reviewed every photo here. Nicely done." },
  team: { title: "No family picks yet", body: "Photos anyone in the family selects will appear here." },
};

function AlbumView({
  route,
  title,
  subtitle,
  albums,
  photos,
  marks,
  rotations,
  me,
  users,
  save,
  rotate,
  go,
}: {
  route: Extract<Route, { view: "album" | "photo" }>;
  title: string;
  subtitle: string;
  albums: string[];
  photos: Photo[];
  marks: Marks;
  rotations: Rotations;
  me: Me;
  users: UserRow[];
  save: (pids: string[], patch: Partial<Mark>) => void;
  rotate: (pid: string, delta: number) => void;
  go: (r: Route, replace?: boolean) => void;
}) {
  const { album, tab, who } = route;
  const [search, setSearch] = useState("");
  const [density, setDensity] = useState<Density>(() => store("wp.density", "m"));
  const [limit, setLimit] = useState(240);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  // The list is a snapshot: marking a photo doesn't make it jump out of the
  // current tab until you leave the viewer, so you never lose your place.
  const [snap, setSnap] = useState(0);
  const inViewer = route.view === "photo";
  useEffect(() => {
    if (!inViewer) setSnap((s) => s + 1);
  }, [inViewer]);

  const matchesTab = useCallback(
    (pm: Map<number, Mark> | undefined) => {
      const mine = pm?.get(me.id)?.status;
      switch (tab) {
        case "mine":
          return mine === "select";
        case "maybe":
          return mine === "maybe";
        case "unseen":
          return !mine;
        case "team":
          if (!pm) return false;
          return who != null
            ? pm.get(who)?.status === "select"
            : [...pm.values()].some((x) => x.status === "select");
      }
      return true;
    },
    [tab, who, me.id],
  );

  const list = useMemo(() => {
    const m = marksRef.current;
    const q = search.trim().toLowerCase();
    return photos.filter((p) => {
      if (album !== ALL && p.album !== album) return false;
      if (q && !p.file.toLowerCase().includes(q)) return false;
      return matchesTab(m.get(p.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, album, matchesTab, search, snap]);

  // How many photos in each folder match the current tab, for the folder filter.
  const folderCounts = useMemo(() => {
    const c = new Map<string, number>([[ALL, 0]]);
    for (const p of photos) {
      if (!matchesTab(marks.get(p.id))) continue;
      c.set(p.album, (c.get(p.album) || 0) + 1);
      c.set(ALL, c.get(ALL)! + 1);
    }
    return c;
  }, [photos, marks, matchesTab]);

  const counts = useMemo(() => {
    const c = { all: 0, mine: 0, maybe: 0, unseen: 0, team: 0 } as Record<Tab, number>;
    for (const p of photos) {
      if (album !== ALL && p.album !== album) continue;
      const pm = marks.get(p.id);
      const mine = pm?.get(me.id)?.status;
      c.all++;
      if (mine === "select") c.mine++;
      else if (mine === "maybe") c.maybe++;
      else c.unseen++;
      if (pm && [...pm.values()].some((x) => x.status === "select")) c.team++;
    }
    return c;
  }, [photos, marks, album, me.id]);

  // Load more as the end of the grid comes near. The observer is re-created after every batch so that if
  // the end is *still* in view (fast scrolling, or arriving from a long page) it fires again instead of stalling.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= list.length) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setLimit((l) => l + 240), {
      rootMargin: "1200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, limit]);

  useEffect(() => persist("wp.density", density), [density]);

  const nextAlbum = album === ALL ? null : albums[albums.indexOf(album) + 1];
  const findPhoto = (key: string) => {
    const byId = list.findIndex((p) => p.id === key);
    return byId >= 0 ? byId : list.findIndex((p) => p.file === key); // older links used the bare file name
  };
  const idx = route.view === "photo" ? findPhoto(route.file) : -1;

  // When returning from the viewer, scroll the last-viewed photo into view.
  const lastFile = useRef<string | null>(null);
  useEffect(() => {
    if (route.view === "photo") lastFile.current = route.file;
    else if (lastFile.current) {
      const i = findPhoto(lastFile.current);
      if (i >= limit) setLimit(i + 60);
      const id = list[i]?.id;
      if (id) requestAnimationFrame(() => document.getElementById(`t-${id}`)?.scrollIntoView({ block: "center" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.view]);

  // Opening from the grid pushes one history entry; moving between photos replaces it,
  // so the phone/browser Back button always closes the viewer.
  const openedFromGrid = useRef(false);
  const open = (p: Photo) => {
    openedFromGrid.current = true;
    go({ view: "photo", album, tab, who, file: p.id });
  };
  const close = () => {
    if (openedFromGrid.current) {
      openedFromGrid.current = false;
      history.back();
    } else go({ view: "album", album, tab, who }, true);
  };

  const showFolder = album === ALL;
  const guest = me.isGuest;
  const empty = search.trim()
    ? { title: "No matches", body: `No photo names contain “${search.trim()}”.` }
    : guest
      ? { title: "No photos yet", body: "Check back soon." }
      : EMPTY[tab];

  return (
    <main className="album">
      <section className="page-head">
        <div className="page-head-main">
          {guest && subtitle && <p className="eyebrow">{subtitle}</p>}
          <h1 className="display">{guest && album === ALL ? title : label(album)}</h1>
          <p className="meta">
            {plural(counts.all, "photo")}
            {guest ? null : (
              <>
                {" "}· {fmt(counts.mine)} selected by you
                {counts.team > 0 && <> · {fmt(counts.team)} picked by family</>}
              </>
            )}
          </p>
        </div>
        {albums.length > 1 && (
          <div className="folder-switch" role="group" aria-label="Folder">
            {[ALL, ...albums].map((a) => (
              <button
                key={a}
                className={album === a ? "on" : ""}
                aria-pressed={album === a}
                onClick={() => go({ view: "album", album: a, tab, who }, true)}
              >
                {a === ALL ? "All" : label(a)}
                <span>{fmt(folderCounts.get(a) || 0)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="toolbar">
        <div className="toolbar-inner">
          {guest ? (
            <span />
          ) : (
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => go({ view: "album", album, tab: t.key, who: null }, true)}
              >
                <span className="tab-long">{t.label}</span>
                <span className="tab-short">{t.short}</span>
                <span className="count">{fmt(counts[t.key])}</span>
              </button>
            ))}
          </div>
          )}
          <div className="tools">
            {tab === "team" && (
              <label className="select">
                <select
                  value={who ?? ""}
                  aria-label="Picked by"
                  onChange={(e) =>
                    go({ view: "album", album, tab, who: e.target.value ? Number(e.target.value) : null }, true)
                  }
                >
                  <option value="">Anyone</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.id === me.id ? `${u.name} (you)` : u.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-down" size={16} />
              </label>
            )}
            <label className="search">
              <Icon name="search" size={17} />
              <input
                type="search"
                placeholder="Search file name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search by file name"
              />
            </label>
            <div className="density" role="group" aria-label="Thumbnail size">
              {(["s", "m", "l"] as Density[]).map((d) => (
                <button
                  key={d}
                  className={density === d ? "on" : ""}
                  aria-pressed={density === d}
                  aria-label={{ s: "Small thumbnails", m: "Medium thumbnails", l: "Large thumbnails" }[d]}
                  onClick={() => setDensity(d)}
                >
                  <Icon name={`grid-${d}`} size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name={tab === "unseen" ? "check" : tab === "maybe" ? "star" : tab === "team" ? "users" : "image"} size={26} />
          </div>
          <h2>{empty.title}</h2>
          <p>{empty.body}</p>
          {tab !== "all" && !guest && (
            <button className="btn" onClick={() => go({ view: "album", album, tab: "all", who: null }, true)}>
              Browse all photos
            </button>
          )}
        </div>
      ) : (
        <div className={`grid justified d-${density}`}>
          {list.slice(0, limit).map((p) => {
            const pm = marks.get(p.id);
            const mine = pm?.get(me.id)?.status;
            const others = pm ? [...pm].filter(([u, x]) => u !== me.id && x.status === "select").length : 0;
            const deg = rotations.get(p.id) || 0;
            const selected = mine === "select";
            return (
              <div
                key={p.id}
                id={`t-${p.id}`}
                className={`tile ${selected ? "is-selected" : ""} ${mine === "maybe" ? "is-maybe" : ""} ${isSideways(deg) ? "is-portrait" : ""}`}
                // Justified rows: each tile grows in proportion to its shape, so every photo shows uncropped and
                // rows fill the width. Previews are all 3:2, turned 2:3 when rotated a quarter turn.
                style={(() => {
                  const ar = isSideways(deg) ? 2 / 3 : 3 / 2;
                  return { flex: `${ar} 1 calc(${ar} * ${ROW_H[density]})`, aspectRatio: `${ar}` };
                })()}
              >
                <button className="tile-open" onClick={() => open(p)} aria-label={`Open ${p.file}`}>
                  <img src={imgUrl(p, deg)} alt="" loading="lazy" decoding="async" onLoad={markLoaded} />
                </button>
                {!guest && (
                <button
                  className="tile-check"
                  aria-pressed={selected}
                  aria-label={selected ? `Remove ${p.file} from selection` : `Select ${p.file}`}
                  onClick={() => save([p.id], { status: selected ? null : "select" })}
                >
                  <Icon name="check" size={16} strokeWidth={2.5} />
                </button>
                )}
                {mine === "maybe" && (
                  <span className="tile-maybe" title="Maybe">
                    <Icon name="star" size={13} filled />
                  </span>
                )}
                {!guest && (
                <div className="tile-tools">
                  <button onClick={() => rotate(p.id, -90)} aria-label="Rotate left" title="Rotate left">
                    <Icon name="rotate-ccw" size={15} />
                  </button>
                  <button onClick={() => rotate(p.id, 90)} aria-label="Rotate right" title="Rotate right">
                    <Icon name="rotate-cw" size={15} />
                  </button>
                </div>
                )}
                {(showFolder || others > 0) && (
                  <div className="tile-foot">
                    {showFolder && <span className="tile-tag">{label(p.album)}</span>}
                    {others > 0 && (
                      <span className="tile-tag" title={`Selected by ${plural(others, "other person", "other people")}`}>
                        <Icon name="heart" size={11} filled /> {others}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div ref={sentinel} style={{ height: 1 }} />

      {list.length > 0 && limit >= list.length && album !== ALL && tab === "all" && !search && !guest && (
        <div className="end">
          <span className="end-rule" />
          <p className="eyebrow">End of {label(album)}</p>
          {nextAlbum ? (
            <button className="btn btn-primary" onClick={() => go({ view: "album", album: nextAlbum, tab: "all", who: null })}>
              Continue to {label(nextAlbum)} <Icon name="arrow-right" size={18} />
            </button>
          ) : (
            <button className="btn" onClick={() => go({ view: "home" })}>
              Back to all folders
            </button>
          )}
        </div>
      )}

      {route.view === "photo" && idx >= 0 && (
        <Viewer
          list={list}
          index={idx}
          marks={marks}
          rotations={rotations}
          me={me}
          users={users}
          save={save}
          rotate={rotate}
          onIndex={(i) => go({ view: "photo", album, tab, who, file: list[i].id }, true)}
          onClose={close}
        />
      )}
    </main>
  );
}

/* --------------------------------- Viewer --------------------------------- */

function Viewer({
  list,
  index,
  marks,
  rotations,
  me,
  users,
  save,
  rotate,
  onIndex,
  onClose,
}: {
  list: Photo[];
  index: number;
  marks: Marks;
  rotations: Rotations;
  me: Me;
  users: UserRow[];
  save: (pids: string[], patch: Partial<Mark>) => void;
  rotate: (pid: string, delta: number) => void;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const p = list[index];
  const pm = marks.get(p.id);
  const mine = pm?.get(me.id);
  const [autoNext, setAutoNext] = useState(() => store("wp.autoNext", false));
  const deg = rotations.get(p.id) || 0;
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const nameOf = (id: number) => users.find((u) => u.id === id)?.name ?? "Someone";
  const selectedBy = pm ? [...pm].filter(([, x]) => x.status === "select").map(([u]) => u) : [];
  const notes = pm ? [...pm].filter(([, x]) => x.note).map(([u, x]) => ({ u, note: x.note! })) : [];
  const guest = me.isGuest;
  const isSel = mine?.status === "select";
  const isMaybe = mine?.status === "maybe";

  useEffect(() => {
    setLoaded(false);
    setNoteDraft(null);
    // Warm the cache for neighbours so arrow keys feel instant.
    for (const d of [1, -1]) {
      const n = list[index + d];
      if (n) new Image().src = imgUrl(n, 0, true); // unrotated original: served straight from disk, no server work
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, list]);
  
  useEffect(() => persist("wp.autoNext", autoNext), [autoNext]);

  // Take keyboard focus when opening, so keys act on the viewer rather than the grid tile behind it.
  const viewerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    viewerRef.current?.focus({ preventScroll: true });
  }, []);

  // Lock page scroll behind the viewer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // `cur` moves synchronously on navigation; the URL (and `index`) catch up a frame later.
  // Everything that acts on "this photo" reads it, so a fast "→ then Space" never hits the previous one.
  const cur = useRef(index);
  useEffect(() => {
    cur.current = index;
  }, [index]);
  // Which way we moved, so the next photo can slide in from that side.
  const dir = useRef<1 | -1 | 0>(0);
  const step = useCallback(
    (d: number) => {
      const i = cur.current + d;
      if (i < 0 || i >= list.length) return;
      dir.current = d > 0 ? 1 : -1;
      cur.current = i;
      onIndex(i);
    },
    [list.length, onIndex],
  );
  const prev = useCallback(() => step(-1), [step]);
  const next = useCallback(() => step(1), [step]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);
  const toggle = useCallback(
    (s: Status) => {
      const id = list[cur.current].id;
      const turningOn = marksRef.current.get(id)?.get(me.id)?.status !== s;
      save([id], { status: turningOn ? s : null });
      if (turningOn && autoNext) {
        clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(next, 220);
      }
    },
    [list, me.id, save, autoNext, next],
  );

  const keyState = useRef({ next, prev, onClose, toggle, rotate, noteOpen: false, guest });
  keyState.current = { next, prev, onClose, toggle, rotate, noteOpen: noteDraft != null, guest };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys only while typing; a focused toggle or button must not swallow shortcuts.
      const el = e.target as HTMLElement;
      if (el.closest("textarea,select") || (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type))) return;
      // Enter on a focused button/link just presses it. Space always means "select" here (its default — pressing the
      // focused button — is prevented below), so it never does two things at once.
      if (e.key === "Enter" && el.closest("button,a,[role=menuitem]")) return;
      const k = keyState.current;
      if (k.noteOpen) return;
      const id = list[cur.current].id;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowRight") k.next();
      else if (e.key === "ArrowLeft") k.prev();
      else if (e.key === "Escape") k.onClose();
      else if (k.guest) return; // guests can only browse
      else if (e.key === " " || e.key === "Enter" || key === "s") {
        e.preventDefault();
        k.toggle("select");
      } else if (key === "m") k.toggle("maybe");
      else if (key === "n") {
        e.preventDefault();
        setNoteDraft(marksRef.current.get(id)?.get(me.id)?.note ?? "");
      } else if (key === "r") k.rotate(id, 90);
      else if (key === "l") k.rotate(id, -90);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, me.id]);

  // Swipe left/right on touch screens; the photo follows the finger.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Photo ${p.file}`} tabIndex={-1} ref={viewerRef}>
      <div className="v-top">
        <button className="v-icon" onClick={onClose} aria-label="Close">
          <Icon name="x" size={22} />
        </button>
        <div className="v-title">
          <strong>{label(p.album)}</strong>
          <span>
            {fmt(index + 1)} <i>of</i> {fmt(list.length)}
          </span>
        </div>
        <div className="v-top-right">
          {!guest && (
          <label className="switch" title="Move to the next photo after you select one">
            <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />
            <span className="switch-track" />
            <span className="switch-label">Auto-advance</span>
          </label>
          )}
          <div className="popover-anchor" ref={menuRef}>
            <button className="v-icon" onClick={() => setMenu((m) => !m)} aria-label="More options" aria-expanded={menu}>
              <Icon name="more" size={22} />
            </button>
            {menu && (
              <div className="popover dark" role="menu" onClick={() => setMenu(false)}>
                <div className="popover-file">
                  <strong>{p.file}</strong>
                  <span>{label(p.album)}</span>
                </div>
                {!guest && (
                  <>
                    <button role="menuitem" onClick={() => setNoteDraft(mine?.note ?? "")}>
                      <Icon name="note" size={18} /> {mine?.note ? "Edit note" : "Add note for photographer"}
                    </button>
                    <button role="menuitem" onClick={() => rotate(p.id, -90)}>
                      <Icon name="rotate-ccw" size={18} /> Rotate left
                    </button>
                    <button role="menuitem" onClick={() => rotate(p.id, 90)}>
                      <Icon name="rotate-cw" size={18} /> Rotate right
                    </button>
                  </>
                )}
                {p.original && (
                  <a role="menuitem" href={originalUrl(p)} className="menu-2line">
                    <Icon name="download" size={18} />
                    <span>
                      Download original
                      <small>Full resolution · from Google Drive</small>
                    </span>
                  </a>
                )}
                <a role="menuitem" href={imgUrl(p, deg, true)} download={p.file} className="menu-2line">
                  <Icon name="image" size={18} />
                  <span>
                    {p.original ? "Download preview" : "Download"}
                    <small>Smaller file{deg ? ", rotated" : ""} · quick on mobile data</small>
                  </span>
                </a>
                {!guest && (
                <div className="popover-keys">
                  <span>
                    <kbd>←</kbd>
                    <kbd>→</kbd> Browse
                  </span>
                  <span>
                    <kbd>Space</kbd> Select
                  </span>
                  <span>
                    <kbd>M</kbd> Maybe
                  </span>
                  <span>
                    <kbd>R</kbd>
                    <kbd>L</kbd> Rotate
                  </span>
                  <span>
                    <kbd>N</kbd> Note
                  </span>
                  <span>
                    <kbd>Esc</kbd> Close
                  </span>
                </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="v-stage"
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          if (slideRef.current) slideRef.current.style.transition = "none";
        }}
        onTouchMove={(e) => {
          const t = touch.current;
          if (!t || !slideRef.current) return;
          const dx = e.touches[0].clientX - t.x;
          const dy = e.touches[0].clientY - t.y;
          if (Math.abs(dx) < Math.abs(dy)) return;
          // Follow the finger, with resistance at the first/last photo.
          const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === list.length - 1);
          slideRef.current.style.transform = `translateX(${atEdge ? dx * 0.25 : dx}px)`;
          slideRef.current.style.opacity = String(1 - Math.min(Math.abs(dx) / 900, 0.35));
        }}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          const el = slideRef.current;
          const go = Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy);
          const canGo = dx < 0 ? index < list.length - 1 : index > 0;
          if (go && canGo) (dx < 0 ? next : prev)();
          else if (el) {
            // Not far enough: spring back into place.
            el.style.transition = "transform 0.25s cubic-bezier(.2,.8,.2,1), opacity 0.25s";
            el.style.transform = "";
            el.style.opacity = "";
          }
        }}
      >
        <div
          key={p.id}
          ref={slideRef}
          className={`v-slide ${dir.current === 1 ? "from-right" : dir.current === -1 ? "from-left" : ""}`}
        >
          <img src={imgUrl(p, deg)} alt="" className="v-img v-placeholder" />
          {/* Full size is fetched unrotated (cheap for the server) and turned upright by CSS. */}
          <img
            key={p.id}
            src={imgUrl(p, 0, true)}
            alt={p.file}
            className={`v-img ${loaded ? "" : "loading"} ${deg ? `rot rot-${deg}` : ""}`}
            onLoad={() => setLoaded(true)}
            onDoubleClick={() => !guest && toggle("select")}
          />
        </div>
        <button className="v-nav prev" onClick={prev} disabled={index === 0} aria-label="Previous photo">
          <Icon name="chevron-left" size={28} />
        </button>
        <button className="v-nav next" onClick={next} disabled={index === list.length - 1} aria-label="Next photo">
          <Icon name="chevron-right" size={28} />
        </button>
      </div>

      <div className="v-bar">
        <div className="v-people">
          {!guest && selectedBy.length > 0 && (
            <div className="v-pickers">
              <span className="stack">
                {selectedBy.slice(0, 4).map((u) => (
                  <Avatar key={u} name={nameOf(u)} size={24} />
                ))}
              </span>
              <span>
                {selectedBy.length === 1 && selectedBy[0] === me.id
                  ? "Selected by you"
                  : `Selected by ${selectedBy.map((u) => (u === me.id ? "you" : nameOf(u))).join(", ")}`}
              </span>
            </div>
          )}
          {!guest && notes.slice(0, 2).map(({ u, note }) => (
            <button
              key={u}
              className="v-note"
              onClick={() => u === me.id && setNoteDraft(note)}
              disabled={u !== me.id}
            >
              <Icon name="note" size={14} />
              <span>
                <b>{u === me.id ? "You" : nameOf(u)}:</b> {note}
              </span>
            </button>
          ))}
        </div>

        <div className="v-actions">
          <button className="v-icon only-touch" onClick={prev} disabled={index === 0} aria-label="Previous photo">
            <Icon name="chevron-left" size={22} />
          </button>
          {guest ? (
            <a className="v-select" href={p.original ? originalUrl(p) : imgUrl(p, deg, true)} download={p.original ? undefined : p.file}>
              <Icon name="download" size={20} />
              <span>{p.original ? "Download original" : "Download"}</span>
            </a>
          ) : (
          <>
          <button className={`v-btn ${isMaybe ? "on-maybe" : ""}`} onClick={() => toggle("maybe")} aria-pressed={isMaybe} title="Maybe (M)">
            <Icon name="star" size={19} filled={isMaybe} />
            <span>Maybe</span>
          </button>
          <button
            className={`v-select ${isSel ? "on" : ""}`}
            onClick={() => toggle("select")}
            aria-pressed={isSel}
            title="Select (Space)"
          >
            <Icon name="check" size={20} strokeWidth={2.5} />
            <span>{isSel ? "Selected" : "Select"}</span>
          </button>
          <button className="v-btn" onClick={() => rotate(p.id, 90)} title="Rotate (R)">
            <Icon name="rotate-cw" size={19} />
            <span>Rotate</span>
          </button>
          </>
          )}
          <button className="v-icon only-touch" onClick={next} disabled={index === list.length - 1} aria-label="Next photo">
            <Icon name="chevron-right" size={22} />
          </button>
        </div>

        <div className="v-side">
          {p.original && (
            <a className="v-link" href={originalUrl(p)} title="Full-resolution original from Google Drive">
              <Icon name="download" size={16} /> Original
            </a>
          )}
          {!guest && (
            <button className="v-link" onClick={() => setNoteDraft(mine?.note ?? "")}>
              <Icon name="note" size={16} /> {mine?.note ? "Edit note" : "Add note"}
            </button>
          )}
        </div>
      </div>

      {noteDraft != null && (
        <div className="sheet-backdrop" onClick={() => setNoteDraft(null)}>
          <form
            className="sheet"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save([p.id], { note: noteDraft });
              setNoteDraft(null);
            }}
          >
            <div className="sheet-head">
              <h3>Note for the photographer</h3>
              <span>{p.file}</span>
            </div>
            <textarea
              autoFocus
              value={noteDraft}
              maxLength={1000}
              rows={4}
              placeholder="e.g. Crop a little tighter, brighten faces, use for the album cover"
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNoteDraft(null);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
            />
            <div className="sheet-actions">
              {mine?.note && (
                <button
                  type="button"
                  className="btn btn-ghost danger"
                  onClick={() => {
                    save([p.id], { note: null });
                    setNoteDraft(null);
                  }}
                >
                  Delete
                </button>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn-ghost" onClick={() => setNoteDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save note
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
