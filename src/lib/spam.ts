/**
 * Spam defenses, v0:
 *  - Honeypot: a hidden field real users never fill. Bots auto-fill it.
 *  - URL density: messages that are mostly links are junk.
 *  - Turnstile: verified server-side IF the env secret is set (Phase 3 turns
 *    this on for real; the code path is ready now).
 *
 * Policy: spam is NEVER told it was caught — callers should return a fake
 * success response so bots don't learn what works.
 */

export const HONEYPOT_FIELD = '_honey';

export interface SpamVerdict {
  ok: boolean;
  reason?: string;
}

function urlDensityTooHigh(values: string[]): boolean {
  const text = values.join(' ');
  if (text.length < 40) return false;
  const urls = text.match(/https?:\/\/\S+/gi) ?? [];
  const urlChars = urls.reduce((n, u) => n + u.length, 0);
  return urls.length >= 3 || urlChars / text.length > 0.4;
}

async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Turnstile not enabled yet (pre-Phase 3)

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    const json = (await res.json()) as { success: boolean };
    return json.success;
  } catch {
    // Fail open: a Turnstile outage should not take down client forms.
    return true;
  }
}

export async function checkSpam(
  raw: Record<string, unknown>,
  ip?: string
): Promise<SpamVerdict> {
  // 1. Honeypot — any non-empty value is an instant fail.
  const honey = raw[HONEYPOT_FIELD];
  if (typeof honey === 'string' && honey.trim() !== '') {
    return { ok: false, reason: 'honeypot' };
  }

  // 2. URL density across all string values.
  const values = Object.entries(raw)
    .filter(([k, v]) => typeof v === 'string' && !k.startsWith('_') && k !== 'cf-turnstile-response')
    .map(([, v]) => v as string);
  if (urlDensityTooHigh(values)) {
    return { ok: false, reason: 'url-density' };
  }

  // 3. Turnstile (active only when TURNSTILE_SECRET_KEY is set).
  if (process.env.TURNSTILE_SECRET_KEY) {
    const token = typeof raw['cf-turnstile-response'] === 'string'
      ? (raw['cf-turnstile-response'] as string)
      : '';
    if (!token || !(await verifyTurnstile(token, ip))) {
      return { ok: false, reason: 'turnstile' };
    }
  }

  return { ok: true };
}
