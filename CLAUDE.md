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

Standing deliverability rules (apply forever)
1. Visitor email in Reply-To only, never From.
2. All sending through the authenticated subdomain; SPF/DKIM/DMARC aligned.
3. No link tracking, no URL shorteners, correspondence-style templates.
4. Bots filtered before emails exist — spam content sent is your reputation spent.
5. Bounced addresses get fixed or removed, never hammered.
Future options (explicitly deferred)
Port to Cloudflare Workers (trivial with Hono) · per-client sending subdomains if one restaurant's volume grows large · raw SES migration if volume ever makes Resend's margin matter · file uploads only if a client genuinely requires them.
Total estimate: 5–7 working days to production-grade, with a demo-able v0 after day one or two.
