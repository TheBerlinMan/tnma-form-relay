# Form Relay

Internal form backend for agency client sites. Receives form POSTs, validates
and filters them, and delivers branded notification emails to client inboxes
via Resend. Replaces Formspree/FormSubmit with something we own.

**Stack:** Hono on a single Vercel function (Node runtime) · Resend + React
Email · Cloudflare Turnstile (Phase 3) · Neon Postgres (Phase 2).

## Project layout

```
api/index.ts            Vercel entry — wraps the Hono app
src/app.ts              Routes: GET /healthz, POST /f/:formId
src/config/forms.ts     ★ Form registry — add new forms here
src/lib/validate.ts     zod validation from field config + subject templating
src/lib/spam.ts         Honeypot, URL-density, Turnstile (env-gated)
src/lib/email.ts        React Email render + Resend send
src/lib/db.ts           Submission log (v0 stub → Neon in Phase 2)
emails/                 React Email templates
shopify/                Reusable Liquid form snippet for client themes
```

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill `RESEND_API_KEY` and `MAIL_FROM`
   (the From address must be on the verified sending subdomain).
3. Local dev: `npm start` (uses `vercel dev`; add the env vars when prompted
   or via `vercel env`). Don't name this script `dev` — `vercel dev` runs a
   package.json `dev` script as the project's Development Command, which
   would recurse.
4. Preview email templates while editing: `npm run email:preview`.

## Deploy

```
vercel deploy --prod
```

Set `RESEND_API_KEY` and `MAIL_FROM` in the Vercel project (Settings →
Environment Variables) before the first deploy. Point a nice domain at the
project if desired (e.g. `forms.youragency.com`).

## Smoke test

```bash
curl -X POST https://<your-deployment>/f/demo-contact \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"name":"Test Person","email":"test@example.com","message":"Hello from the smoke test"}'
```

Expected: `{"ok":true}` and a styled email in the `to:` inbox configured for
`demo-contact`. Reply-To should be `test@example.com`.

An HTML-form submission (no JSON headers) instead 302-redirects to the form's
`redirectUrl`.

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

## Rules that never change

- Visitor email goes in **Reply-To**, never **From** (DMARC/spoofing).
- All sending happens from the authenticated subdomain.
- Spam checks return **fake success** — never reveal detection to bots.
- Only declared fields are forwarded; unknown fields are dropped.
- No tracking, no shorteners, correspondence-style templates only.

## Roadmap

- **Phase 2 — durability:** shipped. Submissions are logged to Neon before the
  send (schema in `src/lib/db.ts`); failed sends return success to the visitor
  and are retried by `/cron/retry` (max 3 attempts, then an alert to
  `ALERT_EMAIL`). Vercel Cron triggers it daily at 09:00 UTC (Hobby-plan
  limit — for 15-min cadence use Pro or any external pinger sending
  `Authorization: Bearer $CRON_SECRET`). Bounce/failure/complaint events arrive
  signed at `/webhooks/resend` (verified against `RESEND_WEBHOOK_SECRET`) and
  update the row + alert `ALERT_EMAIL`; bounced addresses are never retried.
- **Phase 3 — abuse:** shipped. Per-IP/per-form rate limiting (10 per 10 min,
  Neon-backed, checked before anything is logged), honeypot, URL-density
  heuristics — all spam gets a fake success. Turnstile is verified and ready:
  pass `turnstile_site_key` to the Liquid snippet and set
  `TURNSTILE_SECRET_KEY` in the deployment, together, at go-live.
- **Phase 4 — first client:** branded template per client, mail-tester ≥ 9,
  Google Postmaster registration.
