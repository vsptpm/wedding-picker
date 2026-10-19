import { cookies } from "next/headers";
import crypto from "node:crypto";
import { db } from "./db";

export const SESSION_COOKIE = "wp_session";

export type User = { id: number; name: string; is_admin: number; is_guest: number };

const codeHash = (code: string) => crypto.createHash("sha256").update(`wp:${code}`).digest("hex");

/** Hashes of the codes currently configured; a session is only valid while the code it was made with still exists. */
function liveCodeHashes() {
  return new Set(
    [process.env.ADMIN_CODE, process.env.ACCESS_CODE, process.env.GUEST_CODE].filter(Boolean).map((c) => codeHash(c!)),
  );
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.name, s.role, s.code_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as { id: number; name: string; role: string | null; code_hash: string | null } | undefined;
  if (!row) return null;
  // A session is valid only while the code it was made with is still configured (changing a code signs people out).
  if (!row.role || !row.code_hash || !liveCodeHashes().has(row.code_hash)) {
    db().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return { id: row.id, name: row.name, is_admin: row.role === "admin" ? 1 : 0, is_guest: row.role === "guest" ? 1 : 0 };
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export type SignInResult = { token: string } | { error: "code" | "name" };

/**
 * Three codes: ADMIN_CODE (everything), ACCESS_CODE (family: browse + pick) and GUEST_CODE (view and download the
 * shared selection only — name optional).
 */
export function signIn(rawName: string, code: string): SignInResult {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 40);
  const matches = (env?: string) => !!env && safeEqual(code, env);
  const isAdmin = matches(process.env.ADMIN_CODE);
  const isFamily = !isAdmin && matches(process.env.ACCESS_CODE);
  const isGuest = !isAdmin && !isFamily && matches(process.env.GUEST_CODE);
  if (!isAdmin && !isFamily && !isGuest) return { error: "code" };
  if (!isGuest && !name) return { error: "name" };

  const d = db();
  const now = Date.now();
  const userName = isGuest ? (name ? `${name} (guest)` : "Guest") : name;
  d.prepare(`INSERT INTO users (name, is_admin, is_guest, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING`).run(
    userName,
    isAdmin ? 1 : 0,
    isGuest ? 1 : 0,
    now,
  );
  const user = d.prepare(`SELECT id, is_guest FROM users WHERE name = ?`).get(userName) as { id: number; is_guest: number };
  // A guest code must never sign someone into a family account that happens to share the name, and vice versa.
  if (!!user.is_guest !== isGuest) return { error: isGuest ? "code" : "name" };
  // users.is_admin is only a label for the admin page; actual admin rights live on this session (role below), so
  // typing an admin's name with the family code gives family rights, not admin.
  if (isAdmin) d.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(user.id);

  const role = isAdmin ? "admin" : isGuest ? "guest" : "family";
  const token = crypto.randomBytes(32).toString("hex");
  d.prepare(`INSERT INTO sessions (token, user_id, created_at, code_hash, role) VALUES (?, ?, ?, ?, ?)`).run(
    token,
    user.id,
    now,
    codeHash(code),
    role,
  );
  return { token };
}

export function signOut(token: string) {
  db().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
