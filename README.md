# Form Relay

Internal form backend for agency client sites. Receives form POSTs, validates
and filters them, and delivers branded notification emails to client inboxes
via Resend. 

**Stack:** Hono on a single Vercel function (Node runtime) · Resend + React
Email · Cloudflare Turnstile · Neon Postgres.

## Setup

1. `npm install`
2. Local dev: `npm start`
3. Preview email templates while editing: `npm run email:preview`.


## Deploy

```
npx vercel env pull
npx vercel env set RESEND_API_KEY <your-resend-api-key>
npx vercel env set MAIL_FROM <your-mail-from>
npx vercel deploy --prod
```

## Using form-relay from another app or repo

Any site or application can use this service — there is no SDK, no shared
code, and nothing to install in the consuming repo. Every feature is driven
by one HTTP call:

```
POST https://form-relay-eta.vercel.app/f/<form-id>
```

The only prerequisite lives in *this* repo: the form must be registered in
`src/config/forms.ts` (see the runbooks below) with the consuming site's
origin in `allowedOrigins`, then deployed. After that, the consuming repo
only needs the form id.

### Contact form — plain HTML (any framework or static site)

Works with no JavaScript. On success the visitor is 302-redirected to the
form's configured `redirectUrl`.

```html
<form method="POST" action="https://form-relay-eta.vercel.app/f/<form-id>">
  <input name="name" required maxlength="200">
  <input name="email" type="email" required>
  <textarea name="message" required maxlength="5000"></textarea>

  <!-- Honeypot: keep it hidden and EMPTY. Bots fill it; filled = silently dropped. -->
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <input name="_honey" tabindex="-1" autocomplete="off">
  </div>

  <button type="submit">Send</button>
</form>
```

Field `name` attributes must match the fields declared in the form's
registry entry — undeclared fields are ignored, missing required fields are
a 422.

### Contact form — fetch/JSON (SPA, React, mobile, server-side)

Send `Content-Type: application/json` (or an `Accept: application/json`
header with a normal form body) and you get JSON back instead of a redirect:

```js
const res = await fetch('https://form-relay-eta.vercel.app/f/<form-id>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, message, _honey: '' }),
});
const result = await res.json();
// { ok: true }                                → show your success state
// { ok: false, errors: { email: 'Invalid…' } } → 422, show field errors
```

Browser calls only work from an origin listed in the form's
`allowedOrigins` (CORS is reflected from the registry); server-to-server
calls work from anywhere the origin check allows.

### Waitlist signup from another app

Identical call, waitlist-registered form id, only an `email` (plus optional
`name`) field:

```js
await fetch('https://form-relay-eta.vercel.app/f/<waitlist-form-id>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, name, _honey: '' }),
});
```

The endpoint is **idempotent from the caller's view**: repeat signups,
role addresses, and spam all return `{ ok: true }` — the visitor never
learns whether a thanks email was actually (re-)sent, so the consuming app
can simply show "you're on the list" whenever `ok` is true. The service
handles storage, Resend Audience sync, the thanks email, and the promo code;
the consuming repo renders one input.

### Auto-reply

Nothing to implement in the consuming app. It's enabled per form in this
repo's registry (`autoReply` config) — the visitor confirmation rides the
same submission POST.

### Turnstile (recommended for waitlist/auto-reply forms)

Render Cloudflare's widget in the consuming app and the token forwards
automatically (the field is named `cf-turnstile-response` by the widget):

```html
<div class="cf-turnstile" data-sitekey="<site-key>"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

For fetch-based forms, include the token in the JSON body under the same
key. Enforcement is server-side and only active when `TURNSTILE_SECRET_KEY`
is set in this deployment.

### Response reference

| Result | HTML form | JSON |
|---|---|---|
| Accepted (also spam/duplicate/capped — indistinguishable on purpose) | 302 → `redirectUrl` | `200 { ok: true }` |
| Validation failed | `422 { ok: false, errors }` | `422 { ok: false, errors }` |
| Origin not in `allowedOrigins` | `403` | `403` |
| Unknown form id | `404` | `404` |

Shopify themes can skip all of the above and render the ready-made snippets:
`shopify/form-relay.liquid` (contact) and `shopify/waitlist-relay.liquid`
(waitlist).

## Adding a new form (≈15 min runbook)

1. Add an entry to `src/config/forms.ts`: id, clientName, `to:` inbox(es),
   subject template, redirect URL, allowed origins (the client storefront's
   `https://` origin), and the declared fields.
2. Deploy: `vercel deploy --prod`.
3. Wire up the client site. Shopify: render `shopify/form-relay.liquid` with
   the new `form_id` (adjust the fields in the snippet to match the
   registry); anything else: see "Using form-relay from another app or repo"
   above. For Turnstile, pass
   `turnstile_site_key: '0x4AAAAAADi0RqimZ7HsP72J'` (the shared agency
   widget — add the store's domain to its hostname list in the Cloudflare
   dashboard, and make sure `TURNSTILE_SECRET_KEY` is set in the Vercel env;
   the secret is staged in a comment in `.env`).
4. Recipient onboarding: have the client add the sending address to their
   contacts (or whitelist the domain org-wide in Workspace/M365).
5. Submit a real test from the live site; confirm inbox placement.

## Auto-reply (visitor confirmation)

Opt-in per form: add an `autoReply` config (`subject`, `body` paragraphs,
optional `replyTo`) to a contact form that has `replyToField` set. Behavior:

- **Best-effort, one attempt, only after the client notification succeeded.**
  Never retried by cron — a days-late confirmation is worse than none.
- **Never sent to role addresses** (`noreply@`, `postmaster@`, …).
- The confirmation's Reply-To is `autoReply.replyTo` (default: the form's
  first `to:` address), so a visitor reply lands with the client.
- A bounced confirmation means the *visitor* mistyped their address; the
  alert says so and the submission status is untouched.

**Enable Turnstile on any form with `autoReply`** — it sends mail to
visitor-supplied addresses from the authenticated domain, so keep bots out.

## Waitlist forms

A `kind: 'waitlist'` form captures an email (plus optional name), stores it
in the Neon `waitlist_signups` table (source of truth), syncs it to a Resend
Audience (for future campaigns via Broadcasts, unsubscribe handling built
in), and sends a thanks email with an optional static promo code.

Behavior worth knowing:

- **One thanks email per address, ever.** A repeat signup is a silent
  success with no re-send — the endpoint can't be used to blast a third
  party's inbox. (The promo code is static, so they lost nothing.)
- **Role addresses are silently dropped** — never stored, never mailed.
- **Bounced thanks email → the signup is deleted** from the table and the
  Audience (rule 5). A later re-signup with a working mailbox starts fresh.
- **Unsubscribed contacts who re-signup** hit the dedupe and stay
  unsubscribed in Resend. Deliberate re-subscribe (`contacts.update`) is out
  of scope for now.
- A failed thanks email retries through the normal `/cron/retry` machinery;
  a failed Audience push is re-swept by the same cron (`contact_synced`).
- Without `DATABASE_URL`, dedupe and the list are skipped but the thanks
  email still goes out — durability degrades, delivery doesn't.

### Adding a waitlist form (runbook)

> **API key caveat:** managing Audience contacts needs a **full-access**
> Resend API key. The current deployment uses a send-only key, so audience
> sync fails open (rows sit at `contact_synced = false` and the daily sweep
> keeps retrying). Before the first real waitlist goes live, replace
> `RESEND_API_KEY` with a full-access key in the Vercel env and `.env`.

1. **Resend dashboard → Audiences → Create**, copy the Audience id.
2. First waitlist ever: run the `waitlist_signups` DDL and the
   `ALTER TABLE submissions ADD COLUMN auto_reply_email_id text;` migration
   from the header of `src/lib/db.ts` in the Neon console (one time).
3. Add a registry entry in `src/config/forms.ts` with `kind: 'waitlist'`,
   a required `email` field, and `waitlist: { audienceId, promoCode? }`.
   If using a promo code, create the matching discount in Shopify once.
4. Deploy: `vercel deploy --prod`.
5. In the client's theme, render `shopify/waitlist-relay.liquid` with the new
   `form_id` (and `turnstile_site_key` — strongly recommended, see above).
6. Sign up with a real address; confirm the thanks email, the Neon row
   (`contact_synced = true`), and the contact in the Resend Audience.

## Querying the submission log

`npm run lookup` is a local CLI over the Neon `submissions` table — it answers
"did we get that form on the 14th?" without opening the Neon console. It reads
`DATABASE_URL` (and, for `--resend`, `CRON_SECRET`) from `.env`. Everything is
read-only except `--resend`. Run `npm run lookup -- --help` for a cheat sheet.

### Listing and filtering

```bash
npm run lookup                                  # latest 20 submissions, all forms
npm run lookup -- --form tnma-contact           # one form only
npm run lookup -- --status failed               # pending | sent | failed | bounced
npm run lookup -- --since 2026-06-08            # on/after a date
npm run lookup -- --since 2026-06-01 --until 2026-06-14   # inclusive date range
npm run lookup -- --search maria                # text search across the payload
npm run lookup -- --limit 50                    # more rows (capped at 200)
```

Flags combine freely, e.g. `--form tnma-contact --status failed --since
2026-06-01`. Output is a table: id, form, status, attempt count, created
timestamp, sender name/email, and the start of the message.

### Full detail for one submission

```bash
npm run lookup -- --id <uuid>
```

Prints the complete stored payload plus timestamps and the Resend email id.
Paste that Resend id into the Resend dashboard (Emails → search) to see the
provider-side delivery log for that exact message.

### Re-sending a submission

```bash
npm run lookup -- --resend <uuid>
```

For rows the retry cron gave up on — the "giving up" alert email contains this
exact command with the right id filled in. It re-queues the row (status
`failed`, attempts reset) and then calls the production `/cron/retry` endpoint
with your `CRON_SECRET`, so the send happens through the real deployed
pipeline — same registry entry, template, and From identity as a live
submission. It finishes by printing the row again so you can see the new
status (`sent` = recovered).

Two safety rails refuse to proceed unless you add `--force`:

- **status `sent`** — re-sending delivers a duplicate email to the client.
- **status `bounced`** — the recipient address is bad; re-sending would hammer
  it (deliverability rule 5). Fix the form's `to:` address first, deploy, and
  only then `--force`.

If the deployment ever moves off `form-relay-eta.vercel.app`, set
`FORM_RELAY_URL=<new url>` in `.env` so `--resend` targets the right host.

## Abuse protection & limits

Layered, in request order; every rejection returns a fake success so bots
never learn they were caught:

1. **Origin allowlist** — per form (`allowedOrigins`).
2. **Per-IP rate limit** — 10 requests per IP per form per 10 minutes.
3. **Honeypot** (`_honey`) and **URL-density** content check.
4. **Turnstile** — enforced whenever `TURNSTILE_SECRET_KEY` is set.
5. **Duplicate suppression** — an identical payload for the same form within
   5 minutes (double-clicked Send, impatient retry) is acknowledged but not
   re-emailed.
6. **Daily circuit breaker** — max accepted submissions per form per rolling
   24h (`dailyCap` in the form config, default 200; `demo-contact` is capped
   at 5). Protects the Resend quota and sender reputation from distributed
   attacks that rotate IPs. You get one alert email per day when a cap trips.

Blocked requests are counted (form × reason × day, no content stored) in the
`spam_events` table and reported in the weekly digest; counters are purged
after 90 days.

## Weekly digest

`/cron/digest` (Vercel Cron, Mondays 09:00 UTC) emails `ALERT_EMAIL` a
per-form summary of the trailing 7 days — submissions received, sent, failed,
bounced — plus any rows the retry cron has given up on (each listed with its
ready-to-paste `--resend` command), a breakdown of blocked requests by
reason, and the total size of each waitlist. Trigger it manually anytime:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://form-relay-eta.vercel.app/cron/digest
```

## Future Improvements

- Style weekly email log
- Per-client monthly summary email ("Your website forms received 23 inquiries
  this month") sent to the client, not us — proves the service is working
  during quiet weeks. Trivial variant of `/cron/digest`; build when the first
  restaurant client is live.
- PII hygiene: auto-purge submissions older than ~12 months from the
  `submissions` table (one DELETE added to the existing cron cleanup). Less
  stored personal data, less liability, and clients can be told their
  visitors' messages aren't kept forever. Keep the row counts if the monthly
  summaries should still report long-term totals.
