# Upgrade Plan: Auto-Reply + Waitlist Signup

## Context

form-relay currently sends email in one direction only: visitor submits a form → client gets a notification. Two new features:

1. **Auto-reply** — an opt-in confirmation email back to the visitor after a contact-form submission.
2. **Waitlist signup** — a new form kind that captures an email, stores it in Neon (your own copy of the list), syncs it to a **Resend Audience** (for future campaigns via Broadcasts, with unsubscribe handling built in), and sends a thanks email with an optional **static promo code** from config.

Decisions made:
- **Same repo** — a waitlist is just another form shape reusing the spam gauntlet + email infra.
- **DB + Resend Audiences** for list storage — Neon table is the source of truth, Resend Audience enables campaigns/unsubscribes. Cost: free up to 1,000 marketing contacts, then $40/mo at 5k.
- **Static promo code per form** (e.g. `WELCOME10`) — create the matching discount once in Shopify.

Key design choices:
- **Waitlist reuses `POST /f/:formId`** with a `kind: 'waitlist'` discriminator — the entire gauntlet (origin → rate limit → spam → validate → duplicate → daily cap) is shared; only the post-validation step branches. Waitlist thanks emails flow through the existing `submissions` table so cron retry + bounce webhooks work unchanged.
- **Auto-reply is best-effort, one attempt, only after the notification succeeded.** No cron retry (a days-late confirmation is worse than none). Never sent to role addresses (`noreply@`, etc.).
- **Duplicate waitlist signups → silent success, no re-send** (prevents using the endpoint to blast a third party's inbox from our authenticated domain; the code is static so they lost nothing).
- New nullable `auto_reply_email_id` column on `submissions` so a bounced *visitor* address (auto-reply bounce) isn't confused with a bounced *client* notification in the webhook.

**Phase 0**: the working tree has an uncommitted daily-cap/spam-events feature (README.md, app.ts, forms.ts, db.ts, ratelimit.ts). Commit that first so this work is a clean diff.

## Files

### 1. `src/config/forms.ts` — config types

```ts
export interface AutoReplyConfig {
  subject: string;        // supports {{field}} interpolation
  body: string[];         // paragraphs for the confirmation email
  replyTo?: string;       // where visitor replies go; defaults to form.to[0]
}

export interface WaitlistConfig {
  audienceId: string;     // Resend Dashboard → Audiences
  promoCode?: string;     // static, e.g. 'WELCOME10'
  thanksSubject?: string; // default "You're on the list"
  thanksBody?: string[];
}

// FormConfig additions:
kind?: 'contact' | 'waitlist';   // default 'contact'
autoReply?: AutoReplyConfig;     // requires replyToField
waitlist?: WaitlistConfig;       // required when kind === 'waitlist'
```

Add a cold-start sanity check next to the `formRegistry` construction (fail fast at deploy): `kind: 'waitlist'` requires `waitlist` config; `autoReply` requires `replyToField`. Waitlist convention: the field with `type: 'email'` is the signup email.

Add a `demo-waitlist` smoke-test form (`dailyCap: 5`, fields: required email + optional name, `waitlist: { audienceId: '<from dashboard>', promoCode: 'WELCOME10' }`).

### 2. `src/lib/db.ts` — new table + helpers

DDL to run manually in Neon (add to the header comment, matching existing convention):

```sql
ALTER TABLE submissions ADD COLUMN auto_reply_email_id text;

CREATE TABLE waitlist_signups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id        text NOT NULL,
  email          text NOT NULL,                  -- stored lowercased
  name           text,
  contact_synced boolean NOT NULL DEFAULT false, -- pushed to Resend Audience yet?
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, email)
);
```

New functions, all following the existing fail-open pattern (`getSql()` null check, never throw into the request path):

- `setAutoReplyEmailId(id, emailId?)` — UPDATE submissions
- `findByAutoReplyEmailId(emailId)` → `{ id, formId } | null` — webhook lookup
- `hasWaitlistSignup(formId, email)` → boolean (fails open → false)
- `insertWaitlistSignup(formId, email, name?)` → id | null (`ON CONFLICT DO NOTHING RETURNING id`)
- `markContactSynced(id)`
- `getUnsyncedSignups(limit = 25)` — cron sweep
- `countWaitlistSignups(formId)` — for digest

### 3. `emails/AutoReply.tsx` + `emails/WaitlistThanks.tsx` — new templates

Model both on `emails/DefaultNotification.tsx` (copy styles, don't abstract). Correspondence-style per standing rules: no tracked links, no buttons.

- **AutoReply** props: `{ clientName, visitorName?, body: string[], accentColor?, logoUrl? }`. Footer is the *reverse* of DefaultNotification: "Reply to this email if you'd like to add anything."
- **WaitlistThanks** props: `{ clientName, visitorName?, body: string[], promoCode?, accentColor?, logoUrl? }`. Promo code in a bordered monospace block, plain text.
- Default props on both so `npm run email:preview` shows something real. `npm run build` (esbuild `emails/*.tsx`) picks them up — remember to run before committing (`.js` artifacts are committed).

### 4. `src/lib/email.ts` — new senders

- Extract From construction (current lines 23–29) into `fromFor(form): string`, used by all senders.
- Export `isAutoReplySafe(email)` — regex guard against role addresses (`no-reply`, `noreply`, `postmaster`, `mailer-daemon`, `abuse`, `bounce`, ...).
- `sendAutoReply(form, data)` — to: `data[form.replyToField!]`, replyTo: `form.autoReply.replyTo ?? form.to[0]` (visitor replies reach the client), subject via `renderSubject`, renders AutoReply.
- `sendWaitlistThanks(form, data)` — to: signup email, replyTo: `form.to[0]`, subject `form.waitlist.thanksSubject ?? "You're on the list"`, renders WaitlistThanks with `promoCode`.

### 5. `src/lib/waitlist.ts` (new) — audience sync

```ts
syncAudienceContact(audienceId, email, name?): Promise<boolean>
// resendClient().contacts.create({ audienceId, email, firstName: name, unsubscribed: false })
// true on success OR "already exists" (idempotent); false on other errors
// (leaves contact_synced=false for the cron sweep). Never throws.
```

Verify empirically how `contacts.create` behaves on an existing email (409 vs upsert — not clearly documented) and adjust the error match.

### 6. `src/app.ts` — route flow

**Waitlist branch** — after the daily-cap block (~line 117), before the log/send section:

```
if (form.kind === 'waitlist') {
  email = lowercased value of the type:'email' field
  if (await hasWaitlistSignup(form.id, email)) → log 'waitlist-duplicate', return succeed()  // no re-send
  submissionId = await logSubmission(...)                    // durable, before send
  signupId = await insertWaitlistSignup(form.id, email, name)
  if (signupId && await syncAudienceContact(...)) await markContactSynced(signupId)  // failure → cron sweep
  try { markSent(submissionId, await sendWaitlistThanks(form, result.data)) }
  catch { markFailed(submissionId) }                         // existing cron retry, max 3
  return succeed()
}
```

Order: list row first (durable membership is the point), audience sync second (retryable via sweep), thanks email last (retryable via existing machinery).

**Auto-reply** — in the existing send block (lines 119–131), track `notified = true` after `markSent`, then:

```
if (notified && form.autoReply && visitorEmail && isAutoReplySafe(visitorEmail)) {
  try { setAutoReplyEmailId(submissionId, await sendAutoReply(form, result.data)) }
  catch { console.error(...) }   // best-effort, no retry
}
```

**Webhook** (`POST /webhooks/resend`, bounce + failed cases) — before `setStatusByEmailId`, check `findByAutoReplyEmailId(emailId)`. If it matches: the *visitor's* address bounced — send a differently-worded alert ("visitor address is bad, nothing to fix in the form config") and do **not** change submission status. Waitlist thanks bounces already work via the existing path.

**`/cron/retry`** — (1) in the retry loop, branch: `form.kind === 'waitlist' ? sendWaitlistThanks(form, row.payload) : sendNotification(form, row.payload, row.id)`. (2) After the loop: `getUnsyncedSignups()` → `syncAudienceContact` → `markContactSynced`; include synced count in the response.

**`/cron/digest`** — for each waitlist-kind form, append `"{formId}: waitlist size N"` via `countWaitlistSignups`.

No changes to CORS middleware or `vercel.json`.

### 7. `shopify/waitlist-relay.liquid` (new)

Model on `shopify/form-relay.liquid`: single email input (optional name input gated by a `show_name` param), the same hidden `_honey` block **verbatim**, same optional Turnstile block, `action` posts to `/f/<form_id>` as before.

### 8. Docs

- **README.md**: waitlist runbook (create Audience in dashboard → copy audienceId → run DDL once → add registry entry → render snippet); "Auto-reply" and "Waitlist" sections (dedupe behavior, best-effort auto-reply, role-address guard); note the `ALTER TABLE` migration; recommend enabling Turnstile on any form with `autoReply` or `kind: 'waitlist'` (both send mail to attacker-supplied addresses).
- **CLAUDE.md**: add `src/lib/waitlist.ts` + new templates to layout; add deliverability note: "Auto-replies/thanks emails only after the full spam gauntlet, never to role addresses, never re-sent to duplicates."
- No new env vars.

## Verification

1. `npm run typecheck` && `npm run build`.
2. `npm run email:preview` — eyeball both new templates (promo block, footer direction).
3. Run DDL in Neon console.
4. `npm start` (vercel dev), then:
   - Auto-reply (enable `autoReply` on `demo-contact`): `curl -sX POST localhost:3000/f/demo-contact -d 'name=Test&email=tommyonik@gmail.com&message=hello&_honey='` → 302; two emails arrive; confirmation's Reply-To = `form.to[0]`.
   - Role guard: same with `email=noreply@example.com` → notification only.
   - Waitlist: `curl -sX POST localhost:3000/f/demo-waitlist -d 'email=tommyonik@gmail.com&name=Tommy&_honey='` → thanks email with promo code; `waitlist_signups` row with `contact_synced=true`; `submissions` row `sent`.
   - Audience: check Resend dashboard → Audiences (or `GET /audiences/<id>/contacts` with the API key).
   - Duplicate: repeat waitlist curl → success, **no** second email, `waitlist-duplicate` log.
   - Honeypot: `-d 'email=x@y.com&_honey=gotcha'` → fake success, nothing sent.
   - Cron sweep: set `contact_synced=false` in Neon, hit `/cron/retry` with `Bearer $CRON_SECRET`, confirm re-sync.
5. Deploy preview and re-run the waitlist curl against it.

## Risks / edge cases

- **Backscatter abuse**: both features send mail to attacker-supplied addresses from the authenticated domain. Mitigations: existing gauntlet + waitlist one-email-per-address dedupe; recommend Turnstile (README warning).
- **Unsubscribed re-signup**: dedupe makes it a silent no-op; contact stays unsubscribed in Resend. Re-subscribe (`contacts.update`) explicitly out of scope — note in README.
- **No-DB degradation**: without DATABASE_URL, waitlist dedupe is skipped but delivery still works — matches existing "durability degrades, delivery doesn't" philosophy.
- **Manual steps required**: create the Resend Audience in the dashboard (paste real `audienceId` into config), run the DDL in Neon.
