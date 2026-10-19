import type { Database } from "better-sqlite3";
export function exifOrientation(buf: Buffer | Uint8Array): number | null;
export const ORIENT_DEG: Record<number, number>;
export function driveOrientation(driveId: string, tries?: number): Promise<number>;
export function autoOrient(
  db: Database,
  opts?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
): Promise<{ checked: number; rotated: number; failed: number }>;
