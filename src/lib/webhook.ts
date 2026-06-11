/**
 * Svix-style webhook signature verification (Resend signs with Svix).
 * Implemented with node:crypto to avoid a dependency: the signed content is
 * `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret after
 * the `whsec_` prefix, compared against the space-separated `v1,<sig>` list.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhookSignature(opts: {
  rawBody: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
}): boolean {
  const { rawBody, id, timestamp, signature, secret } = opts;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
    return false;
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);

  return signature.split(' ').some((part) => {
    const sig = part.split(',')[1] ?? '';
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}
