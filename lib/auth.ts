import {getPrivy} from './privy';

/**
 * Verify the caller's Privy access token (Authorization: Bearer header).
 *
 * The verified token does double duty in this architecture: it authenticates
 * the API request AND acts as the user's approval inside key quorums
 * (passed as `user_jwts` in Privy authorization contexts). An expired
 * session therefore hard-stops every quorum the user is a member of.
 */
export async function requireUser(req: Request): Promise<{userId: string; accessToken: string}> {
  const header = req.headers.get('authorization') ?? '';
  const accessToken = header.replace(/^Bearer /, '');
  if (!accessToken) throw new AuthError('Missing Authorization header');
  try {
    const claims = await getPrivy().utils().auth().verifyAccessToken(accessToken);
    return {userId: claims.user_id, accessToken};
  } catch {
    throw new AuthError('Invalid or expired access token');
  }
}

export class AuthError extends Error {}
