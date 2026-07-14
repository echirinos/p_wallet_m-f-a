import {NextResponse} from 'next/server';
import {generateAuthorizationSignatures, type WalletApiRequestSignatureInput} from '@privy-io/node';
import {getPrivy} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser} from '@/lib/store';
import {privyErrorPayload, isPolicyDenial} from '@/lib/privy-errors';

/**
 * Submits the withdrawal with BOTH quorum member signatures:
 *  - the user's signature, derived from their JWT via Privy's user-key
 *    exchange (generateAuthorizationSignatures handles this)
 *  - the passkey's WebAuthn signature over the canonical request payload,
 *    in Privy's `webauthn:<authenticatorData>:<clientDataJSON>:<signature>`
 *    header format
 * The body posted to Privy MUST be byte-identical to what the passkey signed;
 * Privy recomputes the canonical payload and rejects any mismatch.
 */
export async function POST(req: Request) {
  try {
    const {userId, accessToken} = await requireUser(req);
    const {input, webauthn} = (await req.json()) as {
      input: WalletApiRequestSignatureInput;
      webauthn: {signature: string; authenticatorData: string; clientDataJSON: string};
    };
    const rec = await mustGetUser(userId);
    if (!rec.passkey) return NextResponse.json({error: 'No passkey registered'}, {status: 400});

    // Server-side shape validation: only this user's wallet RPC endpoint,
    // only transaction methods. Privy enforces everything else (signature
    // match, policy, quorum threshold).
    if (
      input?.version !== 1 ||
      input?.method !== 'POST' ||
      input?.url !== `https://api.privy.io/v1/wallets/${rec.walletId}/rpc` ||
      !['eth_sendTransaction', 'eth_signTransaction'].includes((input?.body as {method?: string})?.method ?? '')
    ) {
      return NextResponse.json({error: 'Invalid withdrawal payload'}, {status: 400});
    }

    const userSignatures = await generateAuthorizationSignatures(getPrivy(), {
      authorizationContext: {user_jwts: [accessToken]},
      input
    });
    const webauthnSignature = `webauthn:${webauthn.authenticatorData}:${webauthn.clientDataJSON}:${webauthn.signature}`;

    const res = await fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'privy-app-id': process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
        Authorization: `Basic ${Buffer.from(
          `${process.env.NEXT_PUBLIC_PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`
        ).toString('base64')}`,
        'privy-authorization-signature': [...userSignatures, webauthnSignature].join(',')
      },
      body: JSON.stringify(input.body)
    });

    const result = await res.json();
    if (!res.ok) {
      const denied = `${JSON.stringify(result)}`.toLowerCase().includes('policy');
      return NextResponse.json({ok: false, denied, privyError: result}, {status: denied ? 403 : res.status});
    }
    return NextResponse.json({ok: true, result});
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    return NextResponse.json(
      {ok: false, denied: isPolicyDenial(e), privyError: privyErrorPayload(e)},
      {status: 500}
    );
  }
}
