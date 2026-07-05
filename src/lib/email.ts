import { Resend } from 'resend';
import { render } from '@react-email/components';
import DefaultNotification from '../../emails/DefaultNotification.js';
import AutoReply from '../../emails/AutoReply.js';
import WaitlistThanks from '../../emails/WaitlistThanks.js';
import type { FormConfig } from '../config/forms.js';
import { waitlistEmailField } from '../config/forms.js';
import { renderSubject } from './validate.js';

let _resend: Resend | null = null;
export function resendClient(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    _resend = new Resend(key);
  }
  return _resend;
}

/**
 * Per-form From display name (fromName, falling back to clientName) on the
 * fixed authenticated address — the address part of MAIL_FROM never varies.
 */
function fromFor(form: FormConfig): string {
  const mailFrom = process.env.MAIL_FROM; // e.g. 'Acme Forms <forms@mail.youragency.com>'
  if (!mailFrom) throw new Error('MAIL_FROM is not set');
  const address = mailFrom.match(/<(.+)>/)?.[1] ?? mailFrom;
  return `${form.fromName ?? form.clientName} <${address}>`;
}

/**
 * Role addresses (noreply@, postmaster@, ...) never have a human behind them —
 * mailing them is backscatter and usually bounces. Nothing visitor-facing is
 * ever sent to one.
 */
const ROLE_ADDRESS_RE =
  /^(no[-._]?reply|do[-._]?not[-._]?reply|postmaster|mailer[-._]?daemon|abuse|bounces?|spam|hostmaster|webmaster)(\+.*)?@/i;

export function isAutoReplySafe(email: string): boolean {
  return !ROLE_ADDRESS_RE.test(email);
}

/** Sends the notification and returns Resend's email id (for bounce webhooks). */
export async function sendNotification(
  form: FormConfig,
  data: Record<string, string>,
  submissionId: string
): Promise<string | undefined> {
  const fields = form.fields
    .filter((f) => data[f.name])
    .map((f) => ({ label: f.label, value: data[f.name] }));

  const html = await render(
    DefaultNotification({
      clientName: form.clientName,
      formId: form.id,
      fields,
      accentColor: form.accentColor,
      logoUrl: form.logoUrl,
      submissionId,
    })
  );

  const replyTo =
    form.replyToField && data[form.replyToField] ? data[form.replyToField] : undefined;

  const { data: sent, error } = await resendClient().emails.send({
    from: fromFor(form),
    to: form.to,
    cc: form.cc,
    replyTo, // visitor goes here — NEVER in `from` (DMARC/spoofing)
    subject: renderSubject(form.subjectTemplate, data),
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return sent?.id;
}

/**
 * Best-effort confirmation back to the visitor. Caller guarantees the
 * notification already succeeded and the address passed isAutoReplySafe.
 * Returns Resend's email id (stored in auto_reply_email_id, so a visitor
 * bounce is never confused with a client-notification bounce).
 */
export async function sendAutoReply(
  form: FormConfig,
  data: Record<string, string>
): Promise<string | undefined> {
  const autoReply = form.autoReply!;
  const html = await render(
    AutoReply({
      clientName: form.clientName,
      visitorName: data.name,
      body: autoReply.body,
      accentColor: form.accentColor,
      logoUrl: form.logoUrl,
    })
  );

  const { data: sent, error } = await resendClient().emails.send({
    from: fromFor(form),
    to: [data[form.replyToField!]],
    replyTo: autoReply.replyTo ?? form.to[0], // visitor replies reach the client
    subject: renderSubject(autoReply.subject, data),
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return sent?.id;
}

/** Waitlist thanks (+ optional promo code). Returns Resend's email id. */
export async function sendWaitlistThanks(
  form: FormConfig,
  data: Record<string, string>
): Promise<string | undefined> {
  const waitlist = form.waitlist!;
  const html = await render(
    WaitlistThanks({
      clientName: form.clientName,
      visitorName: data.name,
      body: waitlist.thanksBody ?? [
        "Thanks for signing up — you're on the list.",
        "We'll only email you when there's something worth hearing about.",
      ],
      promoCode: waitlist.promoCode,
      accentColor: form.accentColor,
      logoUrl: form.logoUrl,
    })
  );

  const { data: sent, error } = await resendClient().emails.send({
    from: fromFor(form),
    to: [data[waitlistEmailField(form)]],
    replyTo: form.to[0], // questions from the visitor reach the client
    subject: waitlist.thanksSubject ?? "You're on the list",
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return sent?.id;
}
