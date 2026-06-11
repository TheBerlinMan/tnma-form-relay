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
