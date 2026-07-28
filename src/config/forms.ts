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
  /**
   * Which React Email template renders the confirmation. Omit for the neutral
   * multi-client `AutoReply`. Add a value here only when a form's voice is
   * genuinely its own — a bespoke template beats bending the shared one with
   * per-form copy knobs, which leak that voice into every other client.
   */
  template?: 'commission';
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
  /**
   * Which React Email template renders the thanks. Omit for the neutral
   * multi-client `WaitlistThanks` (the one with the promo-code block).
   */
  template?: 'commission';
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

  // ── commission.tnma.me — Bags by TNMA commission survey ─────────────────
  // Slide-deck survey (TheBerlinMan/tnma-commission-form) POSTing JSON. Every
  // value arrives as a string: multi-selects are comma-joined and the two
  // computed numbers are sent as numeric strings, both by the client.
  {
    id: 'tnma-bag-commission',
    clientName: 'TNMA Commission',
    to: ['tommyonik@gmail.com'],
    subjectTemplate: 'New bag commission from {{name}} (${{depositTotal}} deposit)',
    accentColor: '#8db3dd',
    logoUrl: 'https://form-relay-eta.vercel.app/tnma.png',
    redirectUrl: 'https://commission.tnma.me/?sent=1',
    allowedOrigins: ['https://commission.tnma.me'],
    dailyCap: 50, // a handful of spots per round — real volume is tiny
    replyToField: 'email',
    autoReply: {
      subject: 'I received your bag commission survey',
      template: 'commission',
      body: [
        "Thanks for submitting the survey. I've got your response.",
        "Please don't forget to submit the deposit as your spot cannot be confirmed until then. You can find me on Venmo or Zelle at (201) 300-7370.",
      ],
    },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'phone', maxLength: 40 },
      { name: 'usage', label: 'Primary use', type: 'text', maxLength: 200 },
      { name: 'bagSize', label: 'Preferred size', type: 'text', required: true, maxLength: 40 },
      { name: 'heaviestItem', label: 'Heaviest item', type: 'text', required: true, maxLength: 200 },
      { name: 'specificFit', label: 'Needs to fit', type: 'text', maxLength: 200 },
      { name: 'favoriteColors', label: 'Favorite colors', type: 'text', required: true, maxLength: 200 },
      { name: 'dislikedColors', label: 'Colors to avoid', type: 'text', maxLength: 200 },
      { name: 'allergies', label: 'Fabric allergies', type: 'text', maxLength: 200 },
      { name: 'additionalPreferences', label: 'Additional preferences', type: 'textarea', maxLength: 5000 },
      { name: 'instaMatch', label: 'Match an Insta bag', type: 'text', required: true, maxLength: 10 },
      { name: 'instaBag', label: 'Matched bag', type: 'text', maxLength: 20 },
      { name: 'tattoo', label: 'Tattoo embroidery', type: 'text', required: true, maxLength: 10 },
      { name: 'tattooPicks', label: 'Tattoo selections', type: 'text', maxLength: 200 },
      { name: 'tattooCount', label: 'Tattoo count', type: 'number' },
      { name: 'depositTotal', label: 'Deposit total ($)', type: 'number' },
    ],
  },

  // ── commission.tnma.me — waitlist (shown once all spots are filled) ──────
  // No notification is sent for kind:'waitlist' — the signup lands in Neon,
  // the Resend Audience, and the Monday digest. `to[0]` is still load-bearing:
  // it becomes the Reply-To on the visitor's thanks email.
  {
    id: 'tnma-bag-waitlist',
    kind: 'waitlist',
    clientName: 'TNMA Commission',
    to: ['tommyonik@gmail.com'],
    subjectTemplate: 'New bag waitlist signup: {{email}}', // unused for waitlists
    accentColor: '#8db3dd',
    logoUrl: 'https://form-relay-eta.vercel.app/tnma.png',
    redirectUrl: 'https://commission.tnma.me/?waitlist=1',
    allowedOrigins: ['https://commission.tnma.me'],
    dailyCap: 100,
    waitlist: {
      audienceId: '9580eeef-2be6-4750-a473-ef5a5c63ce22', // Resend Dashboard → Audiences
      template: 'commission',
      thanksSubject: "You're on the bag commission waitlist",
      thanksBody: [
        "Thanks for signing up — you're on the list.",
        "If a spot opens up in this round, or when the next round of commissions opens, you'll hear from me here.",
      ],
    },
    fields: [
      // The closed-spots view asks for an email only; `name` stays declared as
      // optional so it degrades to null/undefined all the way down.
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'name', label: 'Name', type: 'text', maxLength: 200 },
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
