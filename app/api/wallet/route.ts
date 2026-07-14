import {NextResponse} from 'next/server';
import {createPublicClient, http, formatEther} from 'viem';
import {baseSepolia} from 'viem/chains';
import {getPrivy, requiredEnv} from '@/lib/privy';
import {requireUser, AuthError} from '@/lib/auth';
import {getUser} from '@/lib/store';
import {EXCHANGE_ADDRESS} from '@/lib/exchange';

/**
 * Live architecture panel data: the wallet's real owner/signers/policies as
 * Privy reports them, plus on-chain balance. Nothing here is hardcoded from
 * the store except quorum labels.
 */
export async function GET(req: Request) {
  try {
    const {userId} = await requireUser(req);
    const rec = await getUser(userId);
    if (!rec) return NextResponse.json({provisioned: false});

    const privy = getPrivy();
    const wallet = await privy.wallets().get(rec.walletId);

    const client = createPublicClient({chain: baseSepolia, transport: http('https://sepolia.base.org')});
    const balance = await client.getBalance({address: rec.address as `0x${string}`}).catch(() => 0n);

    const signerLabel = (signerId: string) =>
      signerId === rec.tradingQuorumId
        ? {name: 'Signer 1 — Trading', members: 'You (session) + backend trading key', rule: 'placeOrder ≤ 0.01 ETH to exchange only'}
        : signerId === rec.passkey?.quorumId
          ? {name: 'Signer 2 — Withdrawal', members: 'You + your passkey', rule: 'transfers out (Base Sepolia)'}
          : {name: 'Signer', members: signerId, rule: 'override policy'};

    return NextResponse.json({
      provisioned: true,
      address: rec.address,
      walletId: rec.walletId,
      balanceEth: formatEther(balance),
      exchange: EXCHANGE_ADDRESS,
      hasPasskey: !!rec.passkey,
      owner: {
        quorumId: wallet.owner_id,
        members: 'You (user) + backend owner key — both required',
        policy: 'Base policy: message signing only. No transfer rules → withdrawals default-DENIED.',
        policyId: requiredEnv('PRIVY_BASE_POLICY_ID')
      },
      signers: (wallet.additional_signers ?? []).map((s: {signer_id: string; override_policy_ids?: string[]}) => ({
        quorumId: s.signer_id,
        policyIds: s.override_policy_ids ?? [],
        ...signerLabel(s.signer_id)
      }))
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({error: e.message}, {status: 401});
    return NextResponse.json({error: (e as Error).message}, {status: 500});
  }
}
