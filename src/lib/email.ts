import { Resend } from 'resend';
import { render } from '@react-email/components';
import DefaultNotification from '../../emails/DefaultNotification.js';
import type { FormConfig } from '../config/forms.js';
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

/** Sends the notification and returns Resend's email id (for bounce webhooks). */
export async function sendNotification(
  form: FormConfig,
  data: Record<string, string>,
  submissionId: string
): Promise<string | undefined> {
  const mailFrom = process.env.MAIL_FROM; // e.g. 'Acme Forms <forms@mail.youragency.com>'
  if (!mailFrom) throw new Error('MAIL_FROM is not set');

  // Per-form From display name (fromName, falling back to clientName) on the
  // fixed authenticated address — the address part of MAIL_FROM never varies.
  const address = mailFrom.match(/<(.+)>/)?.[1] ?? mailFrom;
  const from = `${form.fromName ?? form.clientName} <${address}>`;

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
    from,
    to: form.to,
    cc: form.cc,
    replyTo, // visitor goes here — NEVER in `from` (DMARC/spoofing)
    subject: renderSubject(form.subjectTemplate, data),
    html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return sent?.id;
}
