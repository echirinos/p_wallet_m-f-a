'use client';
import {useCallback, useEffect, useState} from 'react';
import {usePrivy} from '@privy-io/react-auth';
import ArchitecturePanel, {type WalletInfo} from '@/components/ArchitecturePanel';
import Acts from '@/components/Acts';
import {Btn} from '@/components/ui';

export default function Home() {
  const {ready, authenticated, login, logout, getAccessToken} = usePrivy();
  const [info, setInfo] = useState<WalletInfo | null>(null);

  const api = useCallback(
    async (path: string, body?: unknown) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: body === undefined && path === '/api/wallet' ? 'GET' : 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: body ? JSON.stringify(body) : undefined
      });
      return {status: res.status, body: await res.json()};
    },
    [getAccessToken]
  );

  const refresh = useCallback(async () => {
    const {body} = await api('/api/wallet');
    const w = body as WalletInfo;
    if (!w.provisioned) {
      await api('/api/provision', {});
      const {body: after} = await api('/api/wallet');
      setInfo(after as WalletInfo);
    } else {
      setInfo(w);
    }
  }, [api]);

  useEffect(() => {
    if (ready && authenticated && !info) refresh();
  }, [ready, authenticated, info, refresh]);

  return (
    <main>
      <header style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0 22px'}}>
        <div>
          <p className="eyebrow">Privy · secure trading wallets</p>
          <h1 style={{fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em'}}>Demo account</h1>
        </div>
        {ready && authenticated && (
          <button
            data-testid="logout"
            onClick={() => {
              setInfo(null);
              logout();
            }}
            style={{background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, padding: '6px 12px', fontSize: 13}}
          >
            Log out
          </button>
        )}
      </header>

      {!ready ? null : !authenticated ? (
        <div style={{display: 'grid', gap: 16, paddingTop: 28}}>
          <h2 style={{fontSize: 30, lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em'}}>
            Your servers can trade.
            <br />
            <span style={{color: 'var(--accent)'}}>They can never steal.</span>
          </h2>
          <p style={{color: 'var(--muted)', fontSize: 14, maxWidth: '42ch'}}>
            One wallet, three levels of authority — trading stays instant while your session lives,
            and only your passkey can move funds out. Enforced by Privy's policy engine inside
            secure hardware, not by trust in application code.
          </p>
          <div className="term" style={{fontSize: 10.5}}>
            {`owner    › you + backend  · never withdraws
signer 1 › app + session  · orders ≤ 0.01 ETH
signer 2 › you + passkey  · the only way out`}
          </div>
          <Btn testid="login" onClick={login}>
            Log in and get your wallet
          </Btn>
          <p style={{fontSize: 12, color: 'var(--muted)'}}>
            Any email works — a wallet with this architecture is provisioned for you on first login.
            Testnet only (Base Sepolia).
          </p>
        </div>
      ) : (
        <section style={{display: 'grid', gap: 4}}>
          <div style={{display: 'flex', gap: 14}}>
            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0}}>
              <span style={{fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: info?.provisioned ? 'var(--green)' : 'var(--accent)', paddingTop: 2}}>
                {info?.provisioned ? '✓' : '01'}
              </span>
              <div style={{width: 1, flex: 1, background: 'var(--border)', marginTop: 6}} />
            </div>
            <div style={{flex: 1, minWidth: 0, paddingBottom: 26}}>
              <h3 style={{fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em'}}>Your wallet</h3>
              <p style={{fontSize: 13, color: 'var(--muted)', margin: '3px 0 10px'}}>
                Created automatically with three levels of authority — an owner that can never
                withdraw, a trading signer, and (soon) your passkey.
              </p>
              {info ? <ArchitecturePanel info={info} /> : <p style={{color: 'var(--muted)', fontSize: 13}}>Provisioning your wallet…</p>}
            </div>
          </div>
          {info?.provisioned && <Acts api={api} hasPasskey={!!info.hasPasskey} onPasskeyRegistered={refresh} />}
        </section>
      )}
    </main>
  );
}
