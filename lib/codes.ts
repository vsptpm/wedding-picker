import crypto from "node:crypto";
import { db } from "./db";

/**
 * Sign-in codes. Family and guest codes can be changed from the admin page (stored in the settings table, overriding
 * .env.local); the admin code only ever comes from .env.local, so admin access can't be taken over from the web UI.
 */
export type EditableRole = "family" | "guest";
const KEY: Record<EditableRole, string> = { family: "code_family", guest: "code_guest" };
const ENV: Record<EditableRole, string> = { family: "ACCESS_CODE", guest: "GUEST_CODE" };

/** Current code for a role, or null when that kind of access is off. */
export function getCode(role: EditableRole | "admin"): string | null {
  if (role === "admin") return process.env.ADMIN_CODE?.trim() || null;
  const row = db().prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY[role]) as { value: string } | undefined;
  if (row) return row.value || null; // stored empty string = turned off
  return process.env[ENV[role]]?.trim() || null;
}

/** True when the code was set on the admin page rather than in .env.local. */
export function isOverridden(role: EditableRole) {
  return !!db().prepare(`SELECT 1 FROM settings WHERE key = ?`).get(KEY[role]);
}

export const codeHash = (code: string) => crypto.createHash("sha256").update(`wp:${code}`).digest("hex");

/** Hashes of every code currently accepted; sessions made with any other code are no longer valid. */
export function liveCodeHashes() {
  return new Set((["admin", "family", "guest"] as const).map(getCode).filter((c): c is string => !!c).map(codeHash));
}

export type CodeError = "short" | "long" | "spaces" | "same";

export function validateCode(role: EditableRole, code: string): CodeError | null {
  if (code.length < 6) return "short";
  if (code.length > 64) return "long";
  if (/^\s|\s$/.test(code)) return "spaces";
  const others = (["admin", "family", "guest"] as const).filter((r) => r !== role).map(getCode);
  if (others.includes(code)) return "same";
  return null;
}

/**
 * Sets (or with null, turns off) a role's code and signs out everyone who signed in with the previous one.
 * Returns how many sessions ended.
 */
export function setCode(role: EditableRole, code: string | null): number {
  const d = db();
  const previous = getCode(role);
  return d.transaction(() => {
    d.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
      KEY[role],
      code ?? "",
    );
    if (!previous || previous === code) return 0;
    return d.prepare(`DELETE FROM sessions WHERE code_hash = ?`).run(codeHash(previous)).changes;
  })();
}

/** Random 8-digit code — easy to type on a phone; with sign-in rate limiting that's 100 million guesses. */
export function generateCode(role: EditableRole): string {
  for (;;) {
    const c = String(crypto.randomInt(10_000_000, 100_000_000));
    if (!validateCode(role, c)) return c;
  }
}
