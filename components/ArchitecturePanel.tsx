'use client';
import {Card, Mono} from './ui';

export type WalletInfo = {
  provisioned: boolean;
  address?: string;
  walletId?: string;
  balanceEth?: string;
  exchange?: string;
  hasPasskey?: boolean;
  owner?: {quorumId: string; members: string; policy: string};
  signers?: {quorumId: string; name: string; members: string; rule: string}[];
};

function Node({icon, title, sub, rule}: {icon: string; title: string; sub: string; rule: string}) {
  return (
    <div style={{display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)'}}>
      <div style={{fontSize: 16, lineHeight: '20px'}}>{icon}</div>
      <div style={{minWidth: 0}}>
        <p style={{fontSize: 13, fontWeight: 600}}>{title}</p>
        <p style={{fontSize: 12, color: 'var(--muted)'}}>{sub}</p>
        <p style={{fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--amber)', marginTop: 2}}>{rule}</p>
      </div>
    </div>
  );
}

export default function ArchitecturePanel({info}: {info: WalletInfo}) {
  if (!info.provisioned) return null;
  const funded = Number(info.balanceEth ?? '0') > 0;
  return (
    <Card>
      <p className="eyebrow">Trading wallet · Base Sepolia</p>
      <p data-testid="wallet-address" style={{marginTop: 8}}>
        <Mono>{info.address}</Mono>
      </p>
      <p style={{fontSize: 13, marginTop: 4, fontFamily: 'var(--mono)'}}>
        {Number(info.balanceEth).toFixed(5)} ETH{' '}
        {!funded && (
          <a href="https://portal.cdp.coinbase.com/products/faucet" target="_blank" style={{color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-sans)'}}>
            · fund via faucet ↗
          </a>
        )}
      </p>

      <details style={{marginTop: 12}}>
        <summary style={{fontSize: 13, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600}}>
          How authority is split (owner + 2 signers)
        </summary>
        <div style={{marginTop: 10}}>
          <Node icon="👑" title="Owner — 2-of-2 quorum" sub={info.owner!.members} rule={info.owner!.policy} />
          {info.signers!.map((s) => (
            <Node key={s.quorumId} icon={s.name.includes('Trading') ? '⚡' : '🔐'} title={`${s.name} — 2-of-2 quorum`} sub={s.members} rule={s.rule} />
          ))}
          {!info.hasPasskey && (
            <Node icon="🔐" title="Signer 2 — Withdrawal (not set up)" sub="You + your passkey" rule="register a passkey in step 4 to enable withdrawals" />
          )}
        </div>
        <p style={{fontSize: 11, color: 'var(--muted)', marginTop: 8, fontFamily: 'var(--mono)'}}>
          owner quorum {info.owner!.quorumId}
          <br />
          live from GET /v1/wallets/{info.walletId}
        </p>
      </details>
    </Card>
  );
}
