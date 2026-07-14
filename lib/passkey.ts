import {createPublicKey} from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const coseToJwk = require('cose-to-jwk') as (cose: Uint8Array | Buffer) => JsonWebKey;

/**
 * Convert a WebAuthn COSE public key (from passkey registration) to the
 * base64-encoded DER/SPKI format Privy expects for authorization keys.
 */
export function coseToBase64Der(cosePublicKey: Uint8Array): string {
  const jwk = coseToJwk(cosePublicKey);
  const key = createPublicKey({key: jwk as never, format: 'jwk'});
  return key.export({type: 'spki', format: 'der'}).toString('base64');
}

/** Derive WebAuthn rpID/origin from the request so the dev port never matters. */
export function rpFromRequest(req: Request): {rpID: string; origin: string} {
  const origin = req.headers.get('origin') ?? 'http://localhost:3000';
  return {rpID: new URL(origin).hostname, origin};
}

/**
 * Stateless registration-challenge tokens (serverless-safe: no shared memory
 * between invocations). The challenge round-trips through the client inside
 * an HMAC-signed, expiring token so it cannot be forged or swapped.
 */
import {createHmac, timingSafeEqual} from 'node:crypto';

function hmac(data: string): Buffer {
  return createHmac('sha256', process.env.PRIVY_APP_SECRET!).update(data).digest();
}

export function issueChallengeToken(userId: string, challenge: string, ttlMs = 5 * 60_000): string {
  const payload = Buffer.from(JSON.stringify({userId, challenge, exp: Date.now() + ttlMs})).toString('base64url');
  return `${payload}.${hmac(payload).toString('base64url')}`;
}

export function verifyChallengeToken(userId: string, token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const {userId: uid, challenge, exp} = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (uid !== userId || exp < Date.now()) return null;
  return challenge;
}
