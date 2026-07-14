import {NextResponse} from 'next/server';
import {parseEther, isAddress} from 'viem';
import {getPrivy, CAIP2, CHAIN_ID, authKeyFromEnv} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser} from '@/lib/store';
import {privyErrorPayload, isPolicyDenial} from '@/lib/privy-errors';

/**
 * The "money shot": attempts a withdrawal (plain transfer) using Signer 1 —
 * the trading quorum. The trading policy only allows placeOrder calls to the
 * exchange contract, so Privy's policy engine MUST deny this. The verbatim
 * denial is the demo.
 */
export async function POST(req: Request) {
  try {
    const {userId, accessToken} = await requireUser(req);
    const {to, amountEth} = await req.json();
    if (!isAddress(to)) return NextResponse.json({error: 'Invalid destination address'}, {status: 400});
    const rec = await mustGetUser(userId);

    const authorization_context = {
      authorization_private_keys: [authKeyFromEnv('PRIVY_TRADING_KEY_PRIVATE')],
      user_jwts: [accessToken]
    };

    // Use sign-only so the demonstration works before faucet funding; the
    // policy engine evaluates eth_signTransaction with the same rules.
    const signed = await getPrivy().wallets().ethereum().signTransaction(rec.walletId, {
      params: {
        transaction: {
          to,
          value: `0x${parseEther(String(amountEth)).toString(16)}`,
          chain_id: CHAIN_ID,
          gas_limit: '0x5208',
          nonce: 0,
          type: 2,
          max_fee_per_gas: '0x5f5e100',
          max_priority_fee_per_gas: '0x5f5e100'
        }
      },
      authorization_context
    });

    // If we get here the policy FAILED to block — surface loudly.
    return NextResponse.json({
      ok: true,
      unexpected: true,
      warning: 'Withdrawal was NOT blocked — policy misconfiguration!',
      signedTransaction: signed.signed_transaction
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    const payload = privyErrorPayload(e);
    return NextResponse.json(
      {ok: false, denied: isPolicyDenial(e), privyError: payload},
      {status: isPolicyDenial(e) ? 403 : 500}
    );
  }
}
