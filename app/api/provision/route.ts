import {NextResponse} from 'next/server';
import {getPrivy} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {getUser, saveUser} from '@/lib/store';
import {requiredEnv} from '@/lib/privy';

/**
 * Per-user provisioning (idempotent). Creates:
 *  1. Owner quorum      = {user, OWNER key}, threshold 2 — neither party can act alone
 *  2. Trading quorum    = {user, TRADING key}, threshold 2 — "user session as MFA"
 *  3. Wallet            = owner quorum + base policy + trading signer w/ override policy
 * Signer 2 (passkey) is attached later, at passkey registration.
 */
export async function POST(req: Request) {
  try {
    const {userId} = await requireUser(req);
    const existing = await getUser(userId);
    if (existing) return NextResponse.json(existing);

    const privy = getPrivy();

    const ownerQuorum = await privy.keyQuorums().create({
      display_name: `owner:${userId}`,
      user_ids: [userId],
      public_keys: [requiredEnv('PRIVY_OWNER_KEY_PUBLIC')],
      authorization_threshold: 2
    });

    const tradingQuorum = await privy.keyQuorums().create({
      display_name: `trading:${userId}`,
      user_ids: [userId],
      public_keys: [requiredEnv('PRIVY_TRADING_KEY_PUBLIC')],
      authorization_threshold: 2
    });

    const wallet = await privy.wallets().create({
      chain_type: 'ethereum',
      display_name: `trading-wallet:${userId}`,
      owner_id: ownerQuorum.id,
      policy_ids: [requiredEnv('PRIVY_BASE_POLICY_ID')],
      additional_signers: [
        {signer_id: tradingQuorum.id, override_policy_ids: [requiredEnv('PRIVY_TRADING_POLICY_ID')]}
      ]
    });

    const rec = {
      userId,
      walletId: wallet.id,
      address: wallet.address,
      ownerQuorumId: ownerQuorum.id,
      tradingQuorumId: tradingQuorum.id
    };
    await saveUser(rec);
    return NextResponse.json(rec);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    const err = e as {message?: string; error?: unknown};
    console.error('provision failed', err?.message, err?.error);
    return NextResponse.json({error: err?.message ?? 'Provisioning failed', detail: err?.error}, {status: 500});
  }
}
