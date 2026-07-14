import {NextResponse} from 'next/server';
import {parseEther, isAddress} from 'viem';
import {formatRequestForAuthorizationSignature, type WalletApiRequestSignatureInput} from '@privy-io/node';
import {CAIP2} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser} from '@/lib/store';

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Builds the exact Privy RPC request the withdrawal will use, canonicalizes
 * it, and returns it base64url-encoded as the WebAuthn challenge. The passkey
 * therefore signs the REQUEST ITSELF — not a random nonce — so the signature
 * cannot be replayed for any other transaction.
 *
 * The request payload round-trips through the client (stateless — serverless
 * safe). Tampering is not a concern: Privy recomputes the canonical payload
 * of whatever is submitted and rejects if the passkey-signed challenge does
 * not match. /api/withdraw/execute also validates the shape server-side.
 */
export async function POST(req: Request) {
  try {
    const {userId} = await requireUser(req);
    const {to, amountEth} = await req.json();
    if (!isAddress(to)) return NextResponse.json({error: 'Invalid destination address'}, {status: 400});
    const rec = await mustGetUser(userId);
    if (!rec.passkey) return NextResponse.json({error: 'No passkey registered'}, {status: 400});

    const input: WalletApiRequestSignatureInput = {
      version: 1,
      method: 'POST',
      url: `https://api.privy.io/v1/wallets/${rec.walletId}/rpc`,
      body: {
        method: 'eth_sendTransaction',
        caip2: CAIP2,
        params: {
          transaction: {
            to,
            value: `0x${parseEther(String(amountEth)).toString(16)}`
          }
        }
      },
      headers: {'privy-app-id': process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
    };

    const challenge = base64UrlEncode(formatRequestForAuthorizationSignature(input));
    return NextResponse.json({input, challenge, credentialId: rec.passkey.credentialId});
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    return NextResponse.json({error: (e as Error).message}, {status: 500});
  }
}
