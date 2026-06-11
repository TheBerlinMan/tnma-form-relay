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

export interface FormConfig {
  /** Stable ID used in the URL: POST /f/<id> */
  id: string;
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
  /** Declared fields. Unknown submitted fields are ignored, not forwarded. */
  fields: FieldConfig[];
  /**
   * Name of the visitor-email field used for Reply-To (must be one of
   * `fields` with type "email"). Optional — omit for forms with no email.
   */
  replyToField?: string;
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
    replyToField: 'email',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'phone', label: 'Phone', type: 'phone', maxLength: 40 },
      { name: 'message', label: 'Message', type: 'textarea', required: true, maxLength: 5000 },
    ],
  },
];

export const formRegistry: Record<string, FormConfig> = Object.fromEntries(
  forms.map((f) => [f.id, f])
);
