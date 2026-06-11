import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { formRegistry } from './config/forms.js';
import { validateSubmission } from './lib/validate.js';
import { checkSpam } from './lib/spam.js';
import { sendNotification } from './lib/email.js';
import { logSubmission, markSent, markFailed, getRetryable, setStatusByEmailId } from './lib/db.js';
import { sendAlert } from './lib/alert.js';
import { isRateLimited, cleanupRateLimits } from './lib/ratelimit.js';
import { verifyWebhookSignature } from './lib/webhook.js';

const MAX_SEND_ATTEMPTS = 3;

const app = new Hono().basePath('/');

// CORS for fetch()-based form submissions: reflect the origin only when some
// registered form allows it. Per-form origin enforcement still happens in the
// route — this just lets the browser read the JSON response.
const knownOrigins = new Set(Object.values(formRegistry).flatMap((f) => f.allowedOrigins));
app.use(
  '/f/*',
  cors({
    origin: (origin) => (knownOrigins.has(origin) ? origin : undefined),
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
    const origin = c.req.header('origin') ?? c.req.header('referer') ?? '';
    const allowed = form.allowedOrigins.some((o) => origin.startsWith(o));
    if (!allowed) return c.json({ ok: false, error: 'Origin not allowed' }, 403);
  }

  // ── Rate limit, then spam checks: both get a FAKE SUCCESS (never tip off
  // bots). The limiter runs first so a blast caps out before the (external)
  // Turnstile verification and before anything is written to submissions. ──
  const ip =
    c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (await isRateLimited(form.id, ip)) {
    console.log(JSON.stringify({ event: 'spam-rejected', formId: form.id, reason: 'rate-limit' }));
    return succeed();
  }

  const spam = await checkSpam(raw, ip);
  if (!spam.ok) {
    console.log(JSON.stringify({ event: 'spam-rejected', formId: form.id, reason: spam.reason }));
    return succeed();
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const result = validateSubmission(form, raw as Record<string, unknown>);
  if (!result.ok) {
    return c.json({ ok: false, errors: result.errors }, 422);
  }

  // ── Log durably BEFORE sending, then send ────────────────────────────────
  const submissionId = await logSubmission(form.id, result.data);
  try {
    const emailId = await sendNotification(form, result.data, submissionId);
    await markSent(submissionId, emailId);
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
      // Bounced = bad address. Mark it so retries never hammer it (rule 5);
      // the fix is a human one: correct the recipient in the form config.
      const row = emailId ? await setStatusByEmailId(emailId, 'bounced') : null;
      await sendAlert('Email bounced', [
        `To: ${event.data?.to?.join(', ') ?? 'unknown'}`,
        `Subject: ${event.data?.subject ?? 'unknown'}`,
        row ? `Submission: ${row.id} (form ${row.formId})` : `Resend email id: ${emailId}`,
        'Fix or remove the recipient address — it will not be retried.',
      ]);
      break;
    }
    case 'email.failed': {
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
      const emailId = await sendNotification(form, row.payload, row.id);
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

  return c.json({ ok: true, eligible: rows.length, sent, failed });
});

export default app;
