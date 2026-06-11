/**
 * Per-IP, per-form rate limiting (Phase 3), backed by the existing Neon DB so
 * it works across serverless instances without adding a Redis dependency.
 *
 * Fixed-window counter: one row per (form, ip, window), upserted atomically.
 * Generous for humans (a visitor re-submitting a contact form), tight for
 * bots. Over-limit callers get the standard fake success upstream — and the
 * check runs BEFORE anything touches the submissions table, so a blast leaves
 * zero junk log rows.
 *
 * Fails open: no DATABASE_URL or a DB error must never block a real visitor.
 */

import { getSql } from './db.js';

const WINDOW_SECONDS = 10 * 60;
const MAX_PER_WINDOW = 10;

export async function isRateLimited(formId: string, ip: string | undefined): Promise<boolean> {
  const db = getSql();
  if (!db || !ip) return false;

  try {
    const rows = await db`
      INSERT INTO rate_limits (form_id, ip, window_start, count)
      VALUES (${formId}, ${ip}, to_timestamp(floor(extract(epoch FROM now()) / ${WINDOW_SECONDS}) * ${WINDOW_SECONDS}), 1)
      ON CONFLICT (form_id, ip, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count
    `;
    return ((rows[0] as { count: number }).count ?? 0) > MAX_PER_WINDOW;
  } catch (err) {
    console.error(JSON.stringify({ event: 'rate-limit-error', error: String(err) }));
    return false;
  }
}

/** Drops stale windows; called from the cron route. */
export async function cleanupRateLimits(): Promise<void> {
  const db = getSql();
  if (!db) return;
  await db`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
}
