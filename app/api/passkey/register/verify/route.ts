import {NextResponse} from 'next/server';
import {verifyRegistrationResponse} from '@simplewebauthn/server';
import {getPrivy, requiredEnv, authKeyFromEnv} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser, saveUser} from '@/lib/store';
import {rpFromRequest, verifyChallengeToken, coseToBase64Der} from '@/lib/passkey';

/**
 * Verifies the WebAuthn registration, then:
 *  1. registers the passkey's P-256 public key in a new key quorum
 *     {user, passkey} with threshold 2 (both must sign withdrawals)
 *  2. attaches that quorum as Signer 2 on the wallet with the withdrawal
 *     override policy — an ADMIN action, so the wallet's OWNER quorum
 *     (OWNER key + user JWT) must authorize it.
 */
export async function POST(req: Request) {
  try {
    const {userId, accessToken} = await requireUser(req);
    const rec = await mustGetUser(userId);
    const {rpID, origin} = rpFromRequest(req);
    const {attestationResponse, challengeToken} = await req.json();

    const expectedChallenge = challengeToken ? verifyChallengeToken(userId, challengeToken) : null;
    if (!expectedChallenge) return NextResponse.json({error: 'Registration challenge expired'}, {status: 400});

    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedRPID: rpID,
      expectedOrigin: origin,
      expectedChallenge,
      requireUserVerification: false
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({error: 'Passkey verification failed'}, {status: 400});
    }

    const {credential} = verification.registrationInfo;
    const passkeyPublicKey = coseToBase64Der(credential.publicKey);

    const privy = getPrivy();
    const passkeyQuorum = await privy.keyQuorums().create({
      display_name: `withdrawal:${userId}`,
      user_ids: [userId],
      public_keys: [passkeyPublicKey],
      authorization_threshold: 2
    });

    // Admin action: authorized by the owner quorum (OWNER key + user JWT).
    // additional_signers is re-stated in full (update replaces the list).
    await privy.wallets().update(rec.walletId, {
      additional_signers: [
        {signer_id: rec.tradingQuorumId, override_policy_ids: [requiredEnv('PRIVY_TRADING_POLICY_ID')]},
        {signer_id: passkeyQuorum.id, override_policy_ids: [requiredEnv('PRIVY_WITHDRAWAL_POLICY_ID')]}
      ],
      authorization_context: {
        authorization_private_keys: [authKeyFromEnv('PRIVY_OWNER_KEY_PRIVATE')],
        user_jwts: [accessToken]
      }
    });

    await saveUser({
      ...rec,
      passkey: {credentialId: credential.id, publicKeyPem: passkeyPublicKey, quorumId: passkeyQuorum.id}
    });
    return NextResponse.json({verified: true, quorumId: passkeyQuorum.id, credentialId: credential.id});
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    const err = e as {message?: string; error?: unknown};
    console.error('passkey verify failed', err?.message, err?.error);
    return NextResponse.json({error: err?.message ?? 'Verification failed', detail: err?.error}, {status: 500});
  }
}
