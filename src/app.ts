import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { formRegistry, waitlistEmailField } from './config/forms.js';
import { validateSubmission } from './lib/validate.js';
import { checkSpam } from './lib/spam.js';
import {
  sendNotification,
  sendAutoReply,
  sendWaitlistThanks,
  isAutoReplySafe,
} from './lib/email.js';
import { syncAudienceContact, removeAudienceContact } from './lib/waitlist.js';
import {
  logSubmission,
  markSent,
  markFailed,
  getRetryable,
  setStatusByEmailId,
  getWeeklyStats,
  getExhausted,
  hasRecentDuplicate,
  countRecentSubmissions,
  recordSpamEvent,
  getSpamStats,
  setAutoReplyEmailId,
  findByAutoReplyEmailId,
  hasWaitlistSignup,
  insertWaitlistSignup,
  markContactSynced,
  getUnsyncedSignups,
  countWaitlistSignups,
  deleteWaitlistSignup,
} from './lib/db.js';
import { sendAlert } from './lib/alert.js';
import { isRateLimited, cleanupRateLimits } from './lib/ratelimit.js';
import { verifyWebhookSignature } from './lib/webhook.js';

const MAX_SEND_ATTEMPTS = 3;
const DEFAULT_DAILY_CAP = 200;

const app = new Hono().basePath('/');

/**
 * Does a request's Origin (or Referer, for no-CORS HTML form posts) match an
 * allowlist?
 *
 * Matching is EXACT on scheme + host + port. A prefix test would be a hole:
 * "https://tnma.me.attacker.com".startsWith("https://tnma.me") is true, so an
 * attacker only needs a hostname that begins with yours.
 *
 * One deliberate exception: a loopback entry ("http://localhost") matches that
 * host on ANY port, so a single entry covers every local dev server while
 * testing. Remove it before go-live like any other origin.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function originAllowed(allowed: string[], originHeader: string, referer = ''): boolean {
  // A page loaded over file:// sends the literal "null" — unparseable, so it
  // can never match, which is what we want.
  let url: URL;
  try {
    url = new URL(originHeader || referer);
  } catch {
    return false;
  }
  const origin = url.origin; // normalises a full Referer URL down to its origin

  return allowed.some((entry) => {
    if (entry === origin) return true;
    try {
      const a = new URL(entry);
      return (
        LOOPBACK.has(a.hostname) &&
        a.hostname === url.hostname &&
        a.protocol === url.protocol
      );
    } catch {
      return false;
    }
  });
}

// CORS for fetch()-based form submissions: reflect the origin only when some
// registered form allows it. Per-form origin enforcement still happens in the
// route — this just lets the browser read the JSON response.
const knownOrigins = [...new Set(Object.values(formRegistry).flatMap((f) => f.allowedOrigins))];
app.use(
  '/f/*',
  cors({
    origin: (origin) => (originAllowed(knownOrigins, origin) ? origin : undefined),
    allowHeaders: ['Content-Type', 'Accept'],
  })
);

app.get('/healthz', (c) => c.json({ ok: true, service: 'form-relay' }));

app.post('/f/:formId', async (c) => {
  const form = formRegistry[c.req.param('formId')];
  if (!form) return c.json({ ok: false, error: 'Unknown form' }, 404);

  // ── Parse body: supports HTML forms (urlencoded/multipart) and JSON ──────
  let raw: Record<string, unknown> = {};
  const contentType = c.req.header('content-type') ?? '';
  try {
    raw = contentType.includes('application/json')
      ? await c.req.json()
      : await c.req.parseBody();
  } catch {
    return c.json({ ok: false, error: 'Unreadable body' }, 400);
  }

  const wantsJson =
    contentType.includes('application/json') ||
    (c.req.header('accept') ?? '').includes('application/json');

  const succeed = () =>
    wantsJson ? c.json({ ok: true }) : c.redirect(form.redirectUrl, 302);

  // ── Origin check ──────────────────────────────────────────────────────────
  if (form.allowedOrigins.length > 0) {
    const origin = c.req.header('origin') ?? '';
    const referer = c.req.header('referer') ?? '';
    if (!originAllowed(form.allowedOrigins, origin, referer)) {
      return c.json({ ok: false, error: 'Origin not allowed' }, 403);
    }
  }

  // ── Rate limit, then spam checks: both get a FAKE SUCCESS (never tip off
  // bots). The limiter runs first so a blast caps out before the (external)
  // Turnstile verification and before anything is written to submissions. ──
  const ip =
    c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (await isRateLimited(form.id, ip)) {
    console.log(JSON.stringify({ event: 'spam-rejected', formId: form.id, reason: 'rate-limit' }));
    await recordSpamEvent(form.id, 'rate-limit');
    return succeed();
  }

  const spam = await checkSpam(raw, ip);
  if (!spam.ok) {
    console.log(JSON.stringify({ event: 'spam-rejected', formId: form.id, reason: spam.reason }));
    await recordSpamEvent(form.id, spam.reason ?? 'spam');
    return succeed();
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const result = validateSubmission(form, raw as Record<string, unknown>);
  if (!result.ok) {
    return c.json({ ok: false, errors: result.errors }, 422);
  }

  // ── Duplicate suppression: a double-clicked Send or impatient retry with
  // an identical payload within 5 minutes shouldn't email the client twice.
  // The visitor still sees success — their message WAS received. ───────────
  if (await hasRecentDuplicate(form.id, result.data)) {
    console.log(JSON.stringify({ event: 'duplicate-suppressed', formId: form.id }));
    return succeed();
  }

  // ── Daily circuit breaker: a distributed bot run that beats the per-IP
  // limit still can't burn the Resend quota or the sender reputation. ──────
  const dailyCap = form.dailyCap ?? DEFAULT_DAILY_CAP;
  if ((await countRecentSubmissions(form.id)) >= dailyCap) {
    const blocked = await recordSpamEvent(form.id, 'daily-cap');
    if (blocked === 1) {
      await sendAlert(`Daily cap hit for ${form.id}`, [
        `The form accepted ${dailyCap} submissions in 24h and is now refusing more (fake success).`,
        'If this is a real traffic spike, raise dailyCap in the form config and redeploy.',
        'If it is an attack, the cap holds until volume drops below the limit.',
      ]);
    }
    return succeed();
  }

  // ── Waitlist: durable list row first (membership is the point), audience
  // sync second (retryable via the cron sweep), thanks email last (retryable
  // via the existing submissions machinery). ───────────────────────────────
  if (form.kind === 'waitlist') {
    const waitlist = form.waitlist!;
    const email = result.data[waitlistEmailField(form)].toLowerCase();
    const name = result.data.name;

    // Role addresses (noreply@ etc.) have no human behind them — pointless on
    // a mailing list and a backscatter risk. Silent success, nothing stored.
    if (!isAutoReplySafe(email)) {
      console.log(JSON.stringify({ event: 'waitlist-role-address', formId: form.id }));
      return succeed();
    }

    // One thanks email per address, EVER: a repeat signup is a silent success
    // with no re-send, so the endpoint can't be used to blast a third party's
    // inbox from our authenticated domain. The code is static — they lost
    // nothing.
    if (await hasWaitlistSignup(form.id, email)) {
      console.log(JSON.stringify({ event: 'waitlist-duplicate', formId: form.id }));
      return succeed();
    }

    const signupId = await insertWaitlistSignup(form.id, email, name);
    if (signupId && (await syncAudienceContact(waitlist.audienceId, email, name))) {
      await markContactSynced(signupId); // failure → /cron/retry sweep
    }

    const submissionId = await logSubmission(form.id, result.data);
    try {
      const emailId = await sendWaitlistThanks(form, result.data);
      await markSent(submissionId, emailId);
    } catch (err) {
      await markFailed(submissionId); // /cron/retry re-attempts, max 3
      console.error(JSON.stringify({ event: 'send-failed', submissionId, error: String(err) }));
    }
    return succeed();
  }

  // ── Log durably BEFORE sending, then send ────────────────────────────────
  const submissionId = await logSubmission(form.id, result.data);
  try {
    const emailId = await sendNotification(form, result.data, submissionId);
    await markSent(submissionId, emailId);

    // Auto-reply: best-effort, ONE attempt, only after the notification
    // succeeded. No cron retry — a days-late confirmation is worse than none.
    const visitorEmail = form.replyToField ? result.data[form.replyToField] : undefined;
    if (form.autoReply && visitorEmail && isAutoReplySafe(visitorEmail)) {
      try {
        await setAutoReplyEmailId(submissionId, await sendAutoReply(form, result.data));
      } catch (err) {
        console.error(
          JSON.stringify({ event: 'auto-reply-failed', submissionId, error: String(err) })
        );
      }
    }
  } catch (err) {
    await markFailed(submissionId);
    console.error(JSON.stringify({ event: 'send-failed', submissionId, error: String(err) }));
    // Soft success: the submission is logged and /cron/retry will re-attempt.
    // The visitor did everything right — don't show them an error.
  }

  return succeed();
});

// ── Resend webhook: bounce/failure events update the row + alert ───────────
app.post('/webhooks/resend', async (c) => {
  const rawBody = await c.req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const valid = verifyWebhookSignature({
      rawBody,
      id: c.req.header('svix-id'),
      timestamp: c.req.header('svix-timestamp'),
      signature: c.req.header('svix-signature'),
      secret,
    });
    if (!valid) return c.json({ ok: false }, 401);
  } else {
    console.error(JSON.stringify({ event: 'webhook-unverified', hint: 'set RESEND_WEBHOOK_SECRET' }));
  }

  let event: { type?: string; data?: { email_id?: string; to?: string[]; subject?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ ok: false }, 400);
  }

  const emailId = event.data?.email_id;
  switch (event.type) {
    case 'email.bounced': {
      // Auto-reply bounce = the VISITOR's address is bad. The client
      // notification was delivered fine, so the submission status stays
      // untouched — there is nothing to fix in the form config.
      const autoReplyRow = emailId ? await findByAutoReplyEmailId(emailId) : null;
      if (autoReplyRow) {
        await sendAlert('Auto-reply bounced (visitor address is bad)', [
          `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
          `Submission: ${autoReplyRow.id} (form ${autoReplyRow.formId})`,
          'The visitor mistyped their email — nothing to fix in the form config.',
        ]);
        break;
      }

      // Bounced = bad address. Mark it so retries never hammer it (rule 5).
      const row = emailId ? await setStatusByEmailId(emailId, 'bounced') : null;

      // Waitlist thanks bounce = also a visitor address. Rule 5 again: pull
      // it from the list and the Audience so a future Broadcast never
      // hammers it. A later re-signup with a working mailbox is welcome.
      const form = row ? formRegistry[row.formId] : undefined;
      if (row && form?.kind === 'waitlist') {
        const visitorEmail = event.data?.to?.[0]?.toLowerCase();
        if (visitorEmail) {
          await deleteWaitlistSignup(row.formId, visitorEmail);
          if (form.waitlist) {
            await removeAudienceContact(form.waitlist.audienceId, visitorEmail);
          }
        }
        await sendAlert('Waitlist thanks bounced — signup removed', [
          `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
          `Submission: ${row.id} (form ${row.formId})`,
          'The visitor address is bad; it was removed from the list and the Resend Audience.',
        ]);
        break;
      }

      // Client notification bounce — the fix is a human one: correct the
      // recipient in the form config.
      await sendAlert('Email bounced', [
        `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
        `Subject: ${event.data?.subject ?? 'unknown'}`,
        row ? `Submission: ${row.id} (form ${row.formId})` : `Resend email id: ${emailId}`,
        'Fix or remove the recipient address — it will not be retried.',
      ]);
      break;
    }
    case 'email.failed': {
      // Auto-replies are best-effort with no retry — don't touch the
      // submission status (the client notification already succeeded).
      const autoReplyRow = emailId ? await findByAutoReplyEmailId(emailId) : null;
      if (autoReplyRow) {
        await sendAlert('Auto-reply delivery failed (not retried)', [
          `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
          `Submission: ${autoReplyRow.id} (form ${autoReplyRow.formId})`,
          'The confirmation is best-effort; the client notification was delivered.',
        ]);
        break;
      }
      const row = emailId ? await setStatusByEmailId(emailId, 'failed') : null;
      await sendAlert('Email delivery failed', [
        `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
        row ? `Submission: ${row.id} (form ${row.formId}) — queued for retry` : `Resend email id: ${emailId}`,
      ]);
      break;
    }
    case 'email.complained':
      await sendAlert('Spam complaint received', [
        `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
        `Subject: ${event.data?.subject ?? 'unknown'}`,
        'A recipient marked a notification as spam — check inbox placement.',
      ]);
      break;
    default:
      break; // delivered/opened/etc. — not tracked on purpose
  }

  return c.json({ ok: true });
});

// ── Retry failed sends (Vercel Cron). Max 3 attempts, then alert. ──────────
app.get('/cron/retry', async (c) => {
  const secret = process.env.CRON_SECRET;
  if (secret && c.req.header('authorization') !== `Bearer ${secret}`) {
    return c.json({ ok: false }, 401);
  }

  await cleanupRateLimits();

  const rows = await getRetryable(MAX_SEND_ATTEMPTS);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const form = formRegistry[row.formId];
    if (!form) {
      // Form removed from the registry since submission. Burn an attempt so
      // this row eventually exhausts instead of alerting forever.
      const attempts = await markFailed(row.id);
      await sendAlert(`Retry skipped: unknown form "${row.formId}"`, [
        `Submission ${row.id} (attempt ${attempts}/${MAX_SEND_ATTEMPTS}).`,
      ]);
      failed++;
      continue;
    }

    try {
      const emailId =
        form.kind === 'waitlist'
          ? await sendWaitlistThanks(form, row.payload)
          : await sendNotification(form, row.payload, row.id);
      await markSent(row.id, emailId);
      sent++;
    } catch (err) {
      const attempts = await markFailed(row.id);
      failed++;
      if (attempts >= MAX_SEND_ATTEMPTS) {
        await sendAlert(`Submission ${row.id} failed ${attempts} times — giving up`, [
          `Form: ${row.formId}`,
          `Last error: ${String(err)}`,
          'Inspect the row in Neon and re-send manually once the cause is fixed.',
        ]);
      }
    }
  }

  // ── Audience sync sweep: signups whose Resend contact push failed. ────────
  const unsynced = await getUnsyncedSignups();
  let synced = 0;
  for (const signup of unsynced) {
    const audienceId = formRegistry[signup.formId]?.waitlist?.audienceId;
    if (!audienceId) continue; // form removed or no longer a waitlist
    if (await syncAudienceContact(audienceId, signup.email, signup.name)) {
      await markContactSynced(signup.id);
      synced++;
    }
  }

  return c.json({ ok: true, eligible: rows.length, sent, failed, synced });
});

// ── Weekly digest (Vercel Cron, Mondays): per-form counts + stuck rows ──────
app.get('/cron/digest', async (c) => {
  const secret = process.env.CRON_SECRET;
  if (secret && c.req.header('authorization') !== `Bearer ${secret}`) {
    return c.json({ ok: false }, 401);
  }

  const stats = await getWeeklyStats();
  const exhausted = await getExhausted(MAX_SEND_ATTEMPTS);

  const byForm = new Map<string, Record<string, number>>();
  for (const s of stats) {
    const counts = byForm.get(s.formId) ?? {};
    counts[s.status] = s.count;
    byForm.set(s.formId, counts);
  }

  const lines: string[] = [];
  if (byForm.size === 0) {
    lines.push('No submissions in the past 7 days.');
  } else {
    for (const [formId, counts] of byForm) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const parts = ['sent', 'pending', 'failed', 'bounced']
        .filter((s) => counts[s])
        .map((s) => `${counts[s]} ${s}`);
      lines.push(`${formId}: ${total} submission${total === 1 ? '' : 's'} — ${parts.join(', ')}`);
    }
  }
  if (exhausted.length > 0) {
    lines.push('');
    lines.push(`NEEDS ATTENTION — gave up after ${MAX_SEND_ATTEMPTS} attempts:`);
    for (const row of exhausted) {
      lines.push(`  ${row.id} (${row.formId}, ${row.createdAt}) — npm run lookup -- --resend ${row.id}`);
    }
  }

  const spamStats = await getSpamStats();
  if (spamStats.length > 0) {
    lines.push('');
    lines.push('Blocked requests (last 7 days):');
    for (const s of spamStats) {
      lines.push(`  ${s.formId}: ${s.count} × ${s.reason}`);
    }
  }

  const waitlistForms = Object.values(formRegistry).filter((f) => f.kind === 'waitlist');
  if (waitlistForms.length > 0) {
    lines.push('');
    lines.push('Waitlists (total size):');
    for (const f of waitlistForms) {
      lines.push(`  ${f.id}: ${await countWaitlistSignups(f.id)}`);
    }
  }

  await sendAlert('Weekly digest', lines);
  return c.json({ ok: true, forms: byForm.size, exhausted: exhausted.length, blocked: spamStats.length });
});

export default app;
