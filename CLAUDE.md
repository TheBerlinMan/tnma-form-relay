Form Relay

Internal Form Backend
Purpose: A lightweight service owned by the agency that receives form POSTs from client websites (Shopify and otherwise) and delivers branded, reliable notification emails to client inboxes — replacing Formspree/FormSubmit with something fully under your control.
Scope guardrails: Built for one agency client and their ~tens of end-clients (restaurants), at up to a few thousand submissions/month each. Not a product. No dashboards, no user accounts, no file uploads, no autoresponders, no open/click tracking.
Final stack:
* Runtime: Hono on a single Vercel serverless function (Node runtime — keeps all DB options open)
* Sending: Resend + React Email templates (From: your dedicated subdomain; Reply-To: the visitor)
* Database: Neon Postgres via HTTP driver — one submissions table, added in Phase 2
* Bot protection: Cloudflare Turnstile + honeypot + origin checks
* Scheduled jobs: Vercel Cron
Running cost: $0/month until you exceed 3,000 emails/month on Resend, then ~$20/month. Everything else stays on free tiers at this volume.

Phase 0 — Foundation
- [x] Decide the form ID convention: one ID per form per client, e.g. robertas-contact, robertas-catering.
- [x] Create the repo: /api (Vercel entry), /src (Hono app, config registry, lib), /emails (React Email templates), /shopify (Liquid snippets).
- [x] Sign up: Vercel, Resend, Cloudflare (Turnstile), Neon (account only — table comes later).
- [x] Designate a dedicated sending subdomain (e.g., mail.youragency.com); verify it in Resend; confirm SPF, DKIM, and DMARC all pass.
Phase 1 — v0: Core pipeline, no database
- [x] POST /f/:formId in Hono: look up the form in a typed TS config registry — { id, clientName, to[], cc[], subjectTemplate, template, redirectUrl, allowedOrigins[] }.
- [x] Reject unknown form IDs and mismatched Origin/Referer headers.
- [x] Validate fields with zod (required fields, types, max lengths).
- [x] Render the default React Email template (clean field table, client name/logo slot, accent color from config) and send via Resend. From: your subdomain. Reply-To: visitor's email — never in From.
- [x] Respond appropriately: 302 redirect to redirectUrl for plain HTML forms; JSON for fetch/AJAX (detect via Accept header).
- [x] Honeypot field check from day one (it's three lines of code).
- [x] For now, Resend's dashboard logs serve as the archive.
Milestone: a test form on a throwaway page delivers a styled, branded email to your inbox. Deployable today.
Phase 2 — v1: Durability
- [x] Create the Neon submissions table: id, form_id, payload (jsonb), status, attempts, created_at, sent_at (+ resend_email_id for webhook correlation).
- [x] Log every valid submission before attempting the send; mark sent or failed after.
- [x] Resend webhook route for bounce/failure events → update the row + alert you (signature-verified via RESEND_WEBHOOK_SECRET; alerts email ALERT_EMAIL).
- [x] GET /cron/retry endpoint, triggered by Vercel Cron (daily on the Hobby plan — 15-min cadence needs Pro or an external pinger with the CRON_SECRET): re-attempt failed rows, max 3 tries, then alert.
Milestone: revoke the Resend API key mid-test; confirm the submission is logged, you're alerted, and it sends successfully after the key is restored.
Phase 3 — Abuse protection
- [x] Turnstile widget on forms; server-side token verification in the Worker. (Snippet renders the widget when passed turnstile_site_key; server verification confirmed against Cloudflare's test keys. Enforcement activates when TURNSTILE_SECRET_KEY is set — flip it on at Phase 4 go-live, since it requires the widget on every live form.)
- [x] Content heuristics: reject submissions that are mostly URLs.
- [x] Per-IP, per-form rate limiting. (Fixed window in Neon: 10 per IP per form per 10 min, checked before anything is logged; fails open if the DB is down.)
- [x] Spam gets a fake success response — never tell bots they were caught.
Milestone: a curl/bot blast produces zero emails and zero junk log rows, while a real submission still flows through.
Phase 4 — Shopify integration & first client
- [x] Build a reusable Liquid snippet/theme block: form action pointing at your endpoint, hidden formId, honeypot, Turnstile widget. Future stores become copy-paste.
- [ ] Wire 1–2 real forms for the first restaurant; build their branded React Email template.
- [ ] Recipient onboarding checklist: add sender to contacts; if on Google Workspace/M365, whitelist the domain org-wide.
- [ ] Verify with mail-tester.com (target 9–10/10); register the sending domain in Google Postmaster Tools.
Milestone: live form on the client's Shopify store delivering branded emails to their real inbox, landing in Primary, not Spam.
Phase 5 — Operational polish (ongoing)
- [ ] A protected lookup route or local script to query the log ("did we get that form on the 14th?").
- [ ] Weekly digest via cron: submissions and failures per form, sent to you.
- [x] A documented 15-minute runbook for adding a new form: add config entry → deploy → paste snippet → whitelist recipient → test. (README "Adding a new form" — validated by wiring tnma-contact.)

Standing deliverability rules (apply forever)
1. Visitor email in Reply-To only, never From.
2. All sending through the authenticated subdomain; SPF/DKIM/DMARC aligned.
3. No link tracking, no URL shorteners, correspondence-style templates.
4. Bots filtered before emails exist — spam content sent is your reputation spent.
5. Bounced addresses get fixed or removed, never hammered.
Future options (explicitly deferred)
Port to Cloudflare Workers (trivial with Hono) · per-client sending subdomains if one restaurant's volume grows large · raw SES migration if volume ever makes Resend's margin matter · file uploads only if a client genuinely requires them.
Total estimate: 5–7 working days to production-grade, with a demo-able v0 after day one or two.
