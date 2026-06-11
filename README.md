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

## Adding a new form (≈15 min runbook)

1. Add an entry to `src/config/forms.ts`: id, clientName, `to:` inbox(es),
   subject template, redirect URL, allowed origins (the client storefront's
   `https://` origin), and the declared fields.
2. Deploy: `vercel deploy --prod`.
3. In the client's Shopify theme, render `shopify/form-relay.liquid` with the
   new `form_id` (adjust the fields in the snippet to match the registry) and
   `turnstile_site_key: '0x4AAAAAADi0RqimZ7HsP72J'` (the shared agency
   widget — add the store's domain to its hostname list in the Cloudflare
   dashboard, and make sure `TURNSTILE_SECRET_KEY` is set in the Vercel env;
   the secret is staged in a comment in `.env`).
4. Recipient onboarding: have the client add the sending address to their
   contacts (or whitelist the domain org-wide in Workspace/M365).
5. Submit a real test from the live site; confirm inbox placement.

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

## Weekly digest

`/cron/digest` (Vercel Cron, Mondays 09:00 UTC) emails `ALERT_EMAIL` a
per-form summary of the trailing 7 days — submissions received, sent, failed,
bounced — plus any rows the retry cron has given up on, each listed with its
ready-to-paste `--resend` command. Trigger it manually anytime:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://form-relay-eta.vercel.app/cron/digest
```