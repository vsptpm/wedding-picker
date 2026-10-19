/**
 * Slows down PIN guessing. A 6-digit code has only 1,000,000 combinations, so without this a script could find it in
 * hours. Limits: 8 wrong codes per client per 15 minutes, and 60 wrong codes across everyone per 15 minutes (so an
 * attacker can't just spread guesses across many addresses). In memory — resets on restart, which is fine for this.
 */
const WINDOW_MS = 15 * 60 * 1000;
const PER_CLIENT = 8;
const GLOBAL = 60;

const failures = new Map<string, number[]>();
let globalFailures: number[] = [];

const recent = (times: number[], now: number) => times.filter((t) => now - t < WINDOW_MS);

/** Minutes until this client may try again, or 0 if allowed. */
export function loginBlockedFor(client: string): number {
  const now = Date.now();
  const mine = recent(failures.get(client) ?? [], now);
  globalFailures = recent(globalFailures, now);
  const oldest = mine.length >= PER_CLIENT ? mine[0] : globalFailures.length >= GLOBAL ? globalFailures[0] : 0;
  return oldest ? Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 60000)) : 0;
}

export function recordLoginFailure(client: string) {
  const now = Date.now();
  failures.set(client, [...recent(failures.get(client) ?? [], now), now]);
  globalFailures.push(now);
  if (failures.size > 5000) for (const [k, v] of failures) if (!recent(v, now).length) failures.delete(k);
}

export function clearLoginFailures(client: string) {
  failures.delete(client);
}
