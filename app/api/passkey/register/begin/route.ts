import {NextResponse} from 'next/server';
import {generateRegistrationOptions} from '@simplewebauthn/server';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser} from '@/lib/store';
import {rpFromRequest, issueChallengeToken} from '@/lib/passkey';

export async function POST(req: Request) {
  try {
    const {userId} = await requireUser(req);
    await mustGetUser(userId); // wallet must exist before adding the withdrawal signer
    const {rpID} = rpFromRequest(req);

    const options = await generateRegistrationOptions({
      rpName: 'Privy Trading Demo',
      rpID,
      userID: Buffer.from(userId),
      userName: userId,
      attestationType: 'none',
      authenticatorSelection: {residentKey: 'preferred', userVerification: 'preferred'},
      supportedAlgorithmIDs: [-7] // ES256 only — P-256, the curve Privy authorization keys use
    });

    return NextResponse.json({options, challengeToken: issueChallengeToken(userId, options.challenge)});
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    return NextResponse.json({error: (e as Error).message}, {status: 500});
  }
}
