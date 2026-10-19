import { cookies } from "next/headers";
import crypto from "node:crypto";
import { db } from "./db";

export const SESSION_COOKIE = "wp_session";

export type User = { id: number; name: string; is_admin: number };

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as User | undefined;
  return row ?? null;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Returns a session token, or null when the code is wrong. */
export function signIn(rawName: string, code: string): string | null {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return null;
  const adminCode = process.env.ADMIN_CODE || "";
  const accessCode = process.env.ACCESS_CODE || "";
  const isAdmin = !!adminCode && safeEqual(code, adminCode);
  if (!isAdmin && !(accessCode && safeEqual(code, accessCode))) return null;

  const d = db();
  const now = Date.now();
  d.prepare(`INSERT INTO users (name, is_admin, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING`).run(
    name,
    isAdmin ? 1 : 0,
    now,
  );
  const user = d.prepare(`SELECT id FROM users WHERE name = ?`).get(name) as { id: number };
  if (isAdmin) d.prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(user.id);

  const token = crypto.randomBytes(32).toString("hex");
  d.prepare(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`).run(token, user.id, now);
  return token;
}

export function signOut(token: string) {
  db().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
