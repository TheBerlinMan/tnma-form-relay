/**
 * Form registry — the single source of truth for every form this service handles.
 *
 * Adding a new form for a client = add an entry here, deploy, point the
 * client's <form action> at /f/<id>. See README "Adding a new form".
 */

export type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'number';

export interface FieldConfig {
  /** The form input's `name` attribute. */
  name: string;
  /** Human label shown in the notification email. */
  label: string;
  type: FieldType;
  required?: boolean;
  maxLength?: number;
}

export interface AutoReplyConfig {
  /** Subject of the visitor confirmation. Supports {{field}} interpolation. */
  subject: string;
  /** Paragraphs of the confirmation body. */
  body: string[];
  /** Where visitor replies to the confirmation go. Defaults to `to[0]`. */
  replyTo?: string;
}

export interface WaitlistConfig {
  /** Resend Audience id (Resend Dashboard → Audiences). */
  audienceId: string;
  /** Static promo code shown in the thanks email, e.g. 'WELCOME10'. Create the
   *  matching discount in Shopify once — the code never varies per visitor. */
  promoCode?: string;
  /** Defaults to "You're on the list". */
  thanksSubject?: string;
  /** Paragraphs of the thanks body. Sensible default if omitted. */
  thanksBody?: string[];
}

export interface FormConfig {
  /** Stable ID used in the URL: POST /f/<id> */
  id: string;
  /**
   * 'contact' (default) emails the client a notification. 'waitlist' stores
   * the signup in Neon, syncs it to a Resend Audience, and thanks the visitor
   * — the whole spam gauntlet is shared; only the post-validation step
   * branches.
   */
  kind?: 'contact' | 'waitlist';
  /** Client/brand name shown in the email header. */
  clientName: string;
  /**
   * From display name, e.g. "Baldi" → `Baldi <forms@mail.tnma.me>`.
   * Defaults to clientName. The address always comes from MAIL_FROM.
   */
  fromName?: string;
  /** Destination inbox(es) for notifications. */
  to: string[];
  cc?: string[];
  /**
   * Subject line. Supports {{field}} interpolation from submitted values,
   * e.g. "New inquiry from {{name}}".
   */
  subjectTemplate: string;
  /** Brand accent color used in the email template. */
  accentColor?: string;
  /** Absolute URL of a logo for the email header (e.g. served from /public). */
  logoUrl?: string;
  /** Where to redirect plain HTML form submissions after success. */
  redirectUrl: string;
  /**
   * Origins allowed to submit this form (scheme + host, no trailing slash).
   * Empty array = allow any origin (use only while testing).
   */
  allowedOrigins: string[];
  /**
   * Circuit breaker: max accepted submissions per rolling 24h. Requests past
   * the cap get a fake success and you get one alert per day. Defaults to 200
   * — far above any real form's volume; it exists to stop a distributed bot
   * run from burning the Resend quota and the sender reputation.
   */
  dailyCap?: number;
  /** Declared fields. Unknown submitted fields are ignored, not forwarded. */
  fields: FieldConfig[];
  /**
   * Name of the visitor-email field used for Reply-To (must be one of
   * `fields` with type "email"). Optional — omit for forms with no email.
   */
  replyToField?: string;
  /**
   * Opt-in confirmation email back to the visitor after a contact-form
   * submission. Requires `replyToField`. Best-effort: one attempt, only
   * after the client notification succeeded, never retried by cron.
   */
  autoReply?: AutoReplyConfig;
  /** Required when kind === 'waitlist'. */
  waitlist?: WaitlistConfig;
}

const forms: FormConfig[] = [
  // ── tnma.me — personal site contact form ────────────────────────────────
  {
    id: 'tnma-contact',
    clientName: 'TNMA',
    to: ['tommyonik@gmail.com'],
    subjectTemplate: 'New message from {{name}}',
    accentColor: '#5780BC',
    logoUrl: 'https://form-relay-eta.vercel.app/tnma.png',
    redirectUrl: 'https://tnma.me/?sent=1',
    allowedOrigins: ['https://tnma.me', 'https://www.tnma.me'],
    replyToField: 'email',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea', required: true, maxLength: 5000 },
    ],
  },

  // ── Example / smoke-test form. Replace with real client forms. ──────────
  {
    id: 'demo-contact',
    clientName: 'Tnma',
    to: ['tommyonik@gmail.com'],
    subjectTemplate: 'New contact form message from {{name}}',
    accentColor: '#8a3324',
    redirectUrl: 'https://example.com/thank-you',
    allowedOrigins: [], // empty while testing; lock down before go-live
    dailyCap: 5, // smoke-test form — keep its blast radius tiny
    replyToField: 'email',
    autoReply: {
      subject: 'We received your message',
      body: [
        'Thanks for getting in touch — your message arrived and we will reply as soon as we can.',
        'If it is urgent, call us directly; the number is on our website.',
      ],
    },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'phone', maxLength: 40 },
      { name: 'message', label: 'Message', type: 'textarea', required: true, maxLength: 5000 },
    ],
  },

  // ── Example / smoke-test waitlist. Replace audienceId before real use. ───
  {
    id: 'demo-waitlist',
    kind: 'waitlist',
    clientName: 'Tnma',
    to: ['tommyonik@gmail.com'],
    subjectTemplate: 'New waitlist signup: {{email}}',
    accentColor: '#8a3324',
    redirectUrl: 'https://example.com/thank-you',
    allowedOrigins: [], // empty while testing; lock down before go-live
    dailyCap: 5, // smoke-test form — keep its blast radius tiny
    waitlist: {
      audienceId: 'REPLACE_WITH_AUDIENCE_ID', // Resend Dashboard → Audiences
      promoCode: 'WELCOME10',
    },
    fields: [
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'name', label: 'Name', type: 'text', maxLength: 200 },
    ],
  },
];

// Config invariants, checked once at cold start. A violation throws here and
// 500s EVERY form until fixed — loud on purpose: `npm run typecheck` can't
// see these, so catch them on the first local `npm start`, never in front of
// a visitor. (Vercel's build does not import this module; the throw surfaces
// at the first invocation, not at deploy.)
for (const f of forms) {
  if (f.kind === 'waitlist') {
    if (!f.waitlist) {
      throw new Error(`Form "${f.id}": kind 'waitlist' requires a waitlist config`);
    }
    if (!f.fields.some((fd) => fd.type === 'email' && fd.required)) {
      throw new Error(`Form "${f.id}": waitlist forms need a required email field`);
    }
  }
  if (f.autoReply && !f.replyToField) {
    throw new Error(`Form "${f.id}": autoReply requires replyToField`);
  }
}

/** Waitlist convention: the form's email field is the signup email. */
export function waitlistEmailField(form: FormConfig): string {
  return form.fields.find((f) => f.type === 'email')!.name;
}

export const formRegistry: Record<string, FormConfig> = Object.fromEntries(
  forms.map((f) => [f.id, f])
);
