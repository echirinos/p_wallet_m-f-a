import {NextResponse} from 'next/server';
import {parseEther} from 'viem';
import {getPrivy, CAIP2, CHAIN_ID, authKeyFromEnv} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {mustGetUser} from '@/lib/store';
import {EXCHANGE_ADDRESS, encodePlaceOrder} from '@/lib/exchange';
import {privyErrorPayload, isPolicyDenial} from '@/lib/privy-errors';

/**
 * Order placement via Signer 1 (trading quorum: TRADING key + user JWT).
 * The trading policy allows this only when the tx targets the exchange
 * contract with placeOrder calldata under the size cap — the policy engine
 * inside Privy's TEE enforces it, not this route.
 */
export async function POST(req: Request) {
  let stage = 'send';
  try {
    const {userId, accessToken} = await requireUser(req);
    const {amountEth} = await req.json();
    const rec = await mustGetUser(userId);
    const amountWei = parseEther(String(amountEth));
    const data = encodePlaceOrder(amountWei);

    const authorization_context = {
      authorization_private_keys: [authKeyFromEnv('PRIVY_TRADING_KEY_PRIVATE')],
      user_jwts: [accessToken]
    };

    const privy = getPrivy();
    try {
      const res = await privy.wallets().ethereum().sendTransaction(rec.walletId, {
        caip2: CAIP2,
        params: {transaction: {to: EXCHANGE_ADDRESS, value: '0x0', data}},
        authorization_context
      });
      return NextResponse.json({ok: true, mode: 'broadcast', hash: res.hash});
    } catch (sendErr) {
      // Policy denial must surface as a denial, not trigger the fallback.
      if (isPolicyDenial(sendErr)) throw sendErr;
      // Otherwise (typically an unfunded wallet failing gas estimation),
      // fall back to sign-only so the policy ALLOW is still demonstrated.
      stage = 'sign-only';
      const signed = await privy.wallets().ethereum().signTransaction(rec.walletId, {
        params: {
          transaction: {
            to: EXCHANGE_ADDRESS,
            value: '0x0',
            data,
            chain_id: CHAIN_ID,
            gas_limit: '0x30d40',
            nonce: 0,
            type: 2,
            max_fee_per_gas: '0x5f5e100',
            max_priority_fee_per_gas: '0x5f5e100'
          }
        },
        authorization_context
      });
      return NextResponse.json({
        ok: true,
        mode: 'sign-only',
        note: 'Wallet unfunded — policy ALLOWED the order and Privy signed it, but it was not broadcast. Fund the wallet from a Base Sepolia faucet to broadcast for real.',
        signedTransaction: signed.signed_transaction
      });
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    const payload = privyErrorPayload(e);
    const denied = isPolicyDenial(e);
    return NextResponse.json(
      {ok: false, denied, stage, privyError: payload},
      {status: denied ? 403 : 500}
    );
  }
}
