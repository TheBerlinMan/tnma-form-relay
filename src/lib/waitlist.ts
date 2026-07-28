/**
 * Resend Audience sync for waitlist forms.
 *
 * The Neon `waitlist_signups` table is the source of truth; the Audience is a
 * downstream copy used for campaigns via Broadcasts (unsubscribe handling
 * built in). Sync failures are never fatal — the row stays
 * contact_synced=false and the /cron/retry sweep picks it up.
 */

import { Resend } from 'resend';
import { resendClient } from './email.js';

/**
 * Contact writes need a full-access Resend key; sending does not. Keeping them
 * apart means the key used on every request — the one in RESEND_API_KEY, which
 * every send in email.ts and alert.ts uses — can stay "sending access only" and
 * is incapable of mutating the account if it ever leaks.
 *
 * Falls back to the send key when unset, so nothing breaks before the second
 * key is provisioned; the sync just keeps failing (non-fatally) as it does now.
 */
let _contacts: Resend | null = null;
function contactsClient(): Resend {
  if (!_contacts) {
    const key = process.env.RESEND_CONTACTS_API_KEY;
    if (!key) return resendClient();
    _contacts = new Resend(key);
  }
  return _contacts;
}

/**
 * Pushes a contact into the Audience. Returns true on success OR when the
 * contact already exists (idempotent — the sweep may re-push); false on any
 * other error, leaving the row for the next sweep. Never throws.
 */
export async function syncAudienceContact(
  audienceId: string,
  email: string,
  name?: string
): Promise<boolean> {
  try {
    const { error } = await contactsClient().contacts.create({
      audienceId,
      email,
      firstName: name,
      unsubscribed: false,
    });
    if (!error) return true;
    // Resend's duplicate-contact response isn't clearly documented (409 vs
    // silent upsert) — match generously so an existing contact counts as
    // synced either way.
    if (/already|exist|conflict|duplicate/i.test(`${error.name} ${error.message}`)) {
      return true;
    }
    console.error(
      JSON.stringify({ event: 'audience-sync-failed', audienceId, error: error.message })
    );
    return false;
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'audience-sync-failed', audienceId, error: String(err) })
    );
    return false;
  }
}

/**
 * Best-effort removal after a hard bounce (deliverability rule 5: bounced
 * addresses get fixed or removed — a Broadcast must never hammer a known-bad
 * address). Never throws.
 */
export async function removeAudienceContact(audienceId: string, email: string): Promise<void> {
  try {
    const { error } = await contactsClient().contacts.remove({ audienceId, email });
    if (error) {
      console.error(
        JSON.stringify({ event: 'audience-remove-failed', audienceId, error: error.message })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'audience-remove-failed', audienceId, error: String(err) })
    );
  }
}
