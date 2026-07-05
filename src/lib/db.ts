/**
 * Submission log — Neon Postgres via the HTTP driver (Phase 2).
 *
 * Every valid submission is written BEFORE the send is attempted, so a
 * Resend outage can never lose a submission. If the database itself is
 * unreachable (or DATABASE_URL is unset, e.g. bare local dev), we fall back
 * to console logging with a `nodb-` pseudo-id — the email still goes out;
 * durability degrades, delivery doesn't.
 *
 * Schema (created in Neon):
 *   CREATE TABLE submissions (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     form_id         text NOT NULL,
 *     payload         jsonb NOT NULL,
 *     status          text NOT NULL DEFAULT 'pending', -- pending|sent|failed|bounced
 *     attempts        int  NOT NULL DEFAULT 0,
 *     resend_email_id text,            -- correlates bounce webhooks to rows
 *     created_at      timestamptz NOT NULL DEFAULT now(),
 *     sent_at         timestamptz
 *   );
 *
 *   -- Auto-reply upgrade: a bounced VISITOR address (auto-reply) must never
 *   -- be confused with a bounced CLIENT notification, so the confirmation's
 *   -- Resend id lives in its own column.
 *   ALTER TABLE submissions ADD COLUMN auto_reply_email_id text;
 *
 *   -- Waitlist signups: the source of truth for list membership. The Resend
 *   -- Audience is a downstream copy (contact_synced tracks the push).
 *   CREATE TABLE waitlist_signups (
 *     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     form_id        text NOT NULL,
 *     email          text NOT NULL,                  -- stored lowercased
 *     name           text,
 *     contact_synced boolean NOT NULL DEFAULT false, -- pushed to Resend Audience yet?
 *     created_at     timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE (form_id, email)
 *   );
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export type SubmissionStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export interface RetryableSubmission {
  id: string;
  formId: string;
  payload: Record<string, string>;
  attempts: number;
}

type Sql = NeonQueryFunction<false, false>;
let _sql: Sql | null | undefined;

export function getSql(): Sql | null {
  if (_sql === undefined) {
    // The Vercel Neon integration prefixes its env vars with the project name.
    const url = process.env.DATABASE_URL ?? process.env.form_relay_DATABASE_URL;
    _sql = url ? neon(url) : null;
  }
  return _sql;
}

/** Pseudo-ids mark submissions that never reached the database. */
const isDurable = (id: string) => !id.startsWith('nodb-');

export async function logSubmission(
  formId: string,
  payload: Record<string, string>
): Promise<string> {
  const db = getSql();
  if (db) {
    try {
      const rows = await db`
        INSERT INTO submissions (form_id, payload)
        VALUES (${formId}, ${JSON.stringify(payload)}::jsonb)
        RETURNING id
      `;
      return (rows[0] as { id: string }).id;
    } catch (err) {
      console.error(JSON.stringify({ event: 'db-insert-failed', formId, error: String(err) }));
    }
  }
  const pseudoId = `nodb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(JSON.stringify({ event: 'submission', id: pseudoId, formId, payload }));
  return pseudoId;
}

export async function markSent(id: string, resendEmailId?: string): Promise<void> {
  const db = getSql();
  if (!db || !isDurable(id)) {
    console.log(JSON.stringify({ event: 'status', id, status: 'sent' }));
    return;
  }
  await db`
    UPDATE submissions
    SET status = 'sent', attempts = attempts + 1, sent_at = now(),
        resend_email_id = ${resendEmailId ?? null}
    WHERE id = ${id}::uuid
  `;
}

/** Increments the attempt counter and returns the new total. */
export async function markFailed(id: string): Promise<number> {
  const db = getSql();
  if (!db || !isDurable(id)) {
    console.log(JSON.stringify({ event: 'status', id, status: 'failed' }));
    return 0;
  }
  const rows = await db`
    UPDATE submissions
    SET status = 'failed', attempts = attempts + 1
    WHERE id = ${id}::uuid
    RETURNING attempts
  `;
  return (rows[0] as { attempts: number } | undefined)?.attempts ?? 0;
}

export async function getRetryable(maxAttempts: number): Promise<RetryableSubmission[]> {
  const db = getSql();
  if (!db) return [];
  const rows = await db`
    SELECT id, form_id, payload, attempts
    FROM submissions
    WHERE status = 'failed' AND attempts < ${maxAttempts}
    ORDER BY created_at
    LIMIT 25
  `;
  return rows.map((r) => ({
    id: r.id as string,
    formId: r.form_id as string,
    payload: r.payload as Record<string, string>,
    attempts: r.attempts as number,
  }));
}

/** True when an identical payload for this form arrived in the last 5 minutes
 *  (double-clicked Send, impatient retry) — suppresses duplicate emails. */
export async function hasRecentDuplicate(
  formId: string,
  payload: Record<string, string>
): Promise<boolean> {
  const db = getSql();
  if (!db) return false;
  const rows = await db`
    SELECT 1 FROM submissions
    WHERE form_id = ${formId}
      AND payload = ${JSON.stringify(payload)}::jsonb
      AND created_at > now() - interval '5 minutes'
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Submissions accepted for a form in the trailing 24h (daily circuit breaker). */
export async function countRecentSubmissions(formId: string): Promise<number> {
  const db = getSql();
  if (!db) return 0;
  const rows = await db`
    SELECT count(*)::int AS n FROM submissions
    WHERE form_id = ${formId} AND created_at > now() - interval '24 hours'
  `;
  return (rows[0] as { n: number }).n;
}

/**
 * Bumps the per-day counter for a rejected request (no content stored) and
 * returns the new count — 1 means this is the first such block today, which
 * callers can use to alert exactly once. Never throws: visibility must not
 * break the fake-success path.
 */
export async function recordSpamEvent(formId: string, reason: string): Promise<number> {
  const db = getSql();
  if (!db) return 0;
  try {
    const rows = await db`
      INSERT INTO spam_events (form_id, reason, day, count)
      VALUES (${formId}, ${reason}, CURRENT_DATE, 1)
      ON CONFLICT (form_id, reason, day)
      DO UPDATE SET count = spam_events.count + 1
      RETURNING count
    `;
    return (rows[0] as { count: number }).count;
  } catch (err) {
    console.error(JSON.stringify({ event: 'spam-event-record-failed', error: String(err) }));
    return 0;
  }
}

export interface SpamStat {
  formId: string;
  reason: string;
  count: number;
}

/** Blocked-request totals per form and reason over the trailing 7 days. */
export async function getSpamStats(): Promise<SpamStat[]> {
  const db = getSql();
  if (!db) return [];
  const rows = await db`
    SELECT form_id, reason, sum(count)::int AS count
    FROM spam_events
    WHERE day > CURRENT_DATE - 7
    GROUP BY form_id, reason
    ORDER BY form_id, count DESC
  `;
  return rows.map((r) => ({
    formId: r.form_id as string,
    reason: r.reason as string,
    count: r.count as number,
  }));
}

export interface WeeklyStat {
  formId: string;
  status: string;
  count: number;
}

/** Submission counts per form and status over the trailing 7 days. */
export async function getWeeklyStats(): Promise<WeeklyStat[]> {
  const db = getSql();
  if (!db) return [];
  const rows = await db`
    SELECT form_id, status, count(*)::int AS count
    FROM submissions
    WHERE created_at > now() - interval '7 days'
    GROUP BY form_id, status
    ORDER BY form_id
  `;
  return rows.map((r) => ({
    formId: r.form_id as string,
    status: r.status as string,
    count: r.count as number,
  }));
}

/** Rows the retry cron has given up on — they need manual attention. */
export async function getExhausted(maxAttempts: number): Promise<
  { id: string; formId: string; createdAt: string }[]
> {
  const db = getSql();
  if (!db) return [];
  const rows = await db`
    SELECT id, form_id, created_at
    FROM submissions
    WHERE status = 'failed' AND attempts >= ${maxAttempts}
    ORDER BY created_at DESC
    LIMIT 20
  `;
  return rows.map((r) => ({
    id: r.id as string,
    formId: r.form_id as string,
    createdAt: String(r.created_at),
  }));
}

/** Records the Resend id of the best-effort auto-reply (visitor confirmation). */
export async function setAutoReplyEmailId(id: string, emailId?: string): Promise<void> {
  const db = getSql();
  if (!db || !isDurable(id) || !emailId) return;
  try {
    await db`
      UPDATE submissions SET auto_reply_email_id = ${emailId} WHERE id = ${id}::uuid
    `;
  } catch (err) {
    console.error(JSON.stringify({ event: 'db-update-failed', id, error: String(err) }));
  }
}

/** Webhook lookup: was this Resend email an auto-reply (visitor confirmation)? */
export async function findByAutoReplyEmailId(
  emailId: string
): Promise<{ id: string; formId: string } | null> {
  const db = getSql();
  if (!db) return null;
  const rows = await db`
    SELECT id, form_id FROM submissions
    WHERE auto_reply_email_id = ${emailId}
    LIMIT 1
  `;
  const row = rows[0] as { id: string; form_id: string } | undefined;
  return row ? { id: row.id, formId: row.form_id } : null;
}

/** True when this (lowercased) address already joined the form's waitlist.
 *  Fails open → false: without a database there is no dedupe, but delivery
 *  still works. */
export async function hasWaitlistSignup(formId: string, email: string): Promise<boolean> {
  const db = getSql();
  if (!db) return false;
  try {
    const rows = await db`
      SELECT 1 FROM waitlist_signups
      WHERE form_id = ${formId} AND email = ${email}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch (err) {
    console.error(JSON.stringify({ event: 'db-query-failed', formId, error: String(err) }));
    return false;
  }
}

/** Inserts a waitlist signup; null on duplicate (race with hasWaitlistSignup)
 *  or when the database is unavailable — callers treat both as "skip sync". */
export async function insertWaitlistSignup(
  formId: string,
  email: string,
  name?: string
): Promise<string | null> {
  const db = getSql();
  if (!db) return null;
  try {
    const rows = await db`
      INSERT INTO waitlist_signups (form_id, email, name)
      VALUES (${formId}, ${email}, ${name ?? null})
      ON CONFLICT (form_id, email) DO NOTHING
      RETURNING id
    `;
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  } catch (err) {
    console.error(JSON.stringify({ event: 'db-insert-failed', formId, error: String(err) }));
    return null;
  }
}

export async function markContactSynced(id: string): Promise<void> {
  const db = getSql();
  if (!db) return;
  try {
    await db`
      UPDATE waitlist_signups SET contact_synced = true WHERE id = ${id}::uuid
    `;
  } catch (err) {
    console.error(JSON.stringify({ event: 'db-update-failed', id, error: String(err) }));
  }
}

export interface UnsyncedSignup {
  id: string;
  formId: string;
  email: string;
  name?: string;
}

/** Signups whose Resend Audience push failed at signup time (cron sweep). */
export async function getUnsyncedSignups(limit = 25): Promise<UnsyncedSignup[]> {
  const db = getSql();
  if (!db) return [];
  const rows = await db`
    SELECT id, form_id, email, name
    FROM waitlist_signups
    WHERE contact_synced = false
    ORDER BY created_at
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id as string,
    formId: r.form_id as string,
    email: r.email as string,
    name: (r.name as string | null) ?? undefined,
  }));
}

/** Total list size for a form (weekly digest). */
export async function countWaitlistSignups(formId: string): Promise<number> {
  const db = getSql();
  if (!db) return 0;
  const rows = await db`
    SELECT count(*)::int AS n FROM waitlist_signups WHERE form_id = ${formId}
  `;
  return (rows[0] as { n: number }).n;
}

/** Removes a bounced address from the list (rule 5: bounced addresses get
 *  fixed or removed). A later re-signup with a working mailbox is welcome. */
export async function deleteWaitlistSignup(formId: string, email: string): Promise<boolean> {
  const db = getSql();
  if (!db) return false;
  const rows = await db`
    DELETE FROM waitlist_signups
    WHERE form_id = ${formId} AND email = ${email}
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Updates a row from a Resend webhook event. Returns the affected row's id
 * and form_id, or null when no row matches (e.g. emails sent before Phase 2).
 */
export async function setStatusByEmailId(
  resendEmailId: string,
  status: SubmissionStatus
): Promise<{ id: string; formId: string } | null> {
  const db = getSql();
  if (!db) return null;
  const rows = await db`
    UPDATE submissions
    SET status = ${status}
    WHERE resend_email_id = ${resendEmailId}
    RETURNING id, form_id
  `;
  const row = rows[0] as { id: string; form_id: string } | undefined;
  return row ? { id: row.id, formId: row.form_id } : null;
}
