/**
 * Operational alerts (delivery failures, bounces, exhausted retries).
 * Always logged; additionally emailed to ALERT_EMAIL when configured.
 * Plain text on purpose — these go to the agency, not to clients.
 */

import { resendClient } from './email.js';

export async function sendAlert(subject: string, lines: string[]): Promise<void> {
  console.error(JSON.stringify({ event: 'alert', subject, detail: lines }));

  const to = process.env.ALERT_EMAIL;
  const from = process.env.MAIL_FROM;
  if (!to || !from) return;

  try {
    await resendClient().emails.send({
      from,
      to: [to],
      subject: `[form-relay] ${subject}`,
      text: lines.join('\n'),
    });
  } catch (err) {
    // Alerting must never take down the caller (and if Resend is the thing
    // that's broken, this send fails too — the log line above still lands).
    console.error(JSON.stringify({ event: 'alert-send-failed', error: String(err) }));
  }
}
