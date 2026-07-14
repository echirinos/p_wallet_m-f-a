'use client';
import {useState} from 'react';
import {startRegistration, startAuthentication} from '@simplewebauthn/browser';
import {Btn, ResultCard} from './ui';

type ApiFn = (path: string, body?: unknown) => Promise<{status: number; body: unknown}>;
type Result = {label: string; ok: boolean; body: unknown};

/**
 * WebAuthn ceremonies never settle in environments with no authenticator
 * (e.g. headless browsers) — without a deadline the whole demo locks up.
 */
function withTimeout<T>(p: Promise<T>, ms = 75_000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Passkey ceremony timed out — no authenticator responded. Try again on a device with Touch ID / Face ID.')), ms)
    )
  ]);
}

function Step({n, title, why, state, last, children}: {
  n: number;
  title: string;
  why: string;
  state: 'done' | 'current' | 'locked';
  last?: boolean;
  children?: React.ReactNode;
}) {
  const color = state === 'done' ? 'var(--green)' : state === 'current' ? 'var(--accent)' : 'var(--muted)';
  return (
    <div style={{display: 'flex', gap: 14, opacity: state === 'locked' ? 0.45 : 1}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0}}>
        <span style={{fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color, paddingTop: 2}}>
          {state === 'done' ? '✓' : `0${n}`}
        </span>
        {!last && <div style={{width: 1, flex: 1, background: 'var(--border)', marginTop: 6}} />}
      </div>
      <div style={{paddingBottom: last ? 0 : 26, flex: 1, minWidth: 0}}>
        <h3 style={{fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em'}}>{title}</h3>
        <p style={{fontSize: 13, color: 'var(--muted)', margin: '3px 0 10px'}}>{why}</p>
        {state !== 'locked' && <div style={{display: 'grid', gap: 8}}>{children}</div>}
      </div>
    </div>
  );
}

export default function Acts({api, hasPasskey, onPasskeyRegistered}: {
  api: ApiFn;
  hasPasskey: boolean;
  onPasskeyRegistered: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result[]>>({});
  const [withdrawTo, setWithdrawTo] = useState('0x000000000000000000000000000000000000dEaD');

  const push = (step: string, r: Result) =>
    setResults((prev) => ({...prev, [step]: [r, ...(prev[step] ?? [])]}));

  const run = async (step: string, label: string, path: string, body?: unknown) => {
    setBusy(label);
    try {
      const {status, body: resBody} = await api(path, body);
      push(step, {label, ok: status < 400, body: resBody});
    } catch (e) {
      push(step, {label, ok: false, body: {error: (e as Error).message}});
    } finally {
      setBusy(null);
    }
  };

  const registerPasskey = async () => {
    setBusy('passkey');
    try {
      const {body: begin} = await api('/api/passkey/register/begin');
      const {options, challengeToken} = begin as {options: unknown; challengeToken: string};
      const attestationResponse = await withTimeout(startRegistration({optionsJSON: options as never}));
      const {status, body} = await api('/api/passkey/register/verify', {attestationResponse, challengeToken});
      push('passkey', {label: 'Register passkey', ok: status < 400, body});
      if (status < 400) onPasskeyRegistered();
    } catch (e) {
      push('passkey', {label: 'Register passkey', ok: false, body: {error: (e as Error).message}});
    } finally {
      setBusy(null);
    }
  };

  const withdrawWithPasskey = async () => {
    setBusy('withdraw');
    try {
      const {status: ps, body: prep} = await api('/api/withdraw/prepare', {to: withdrawTo, amountEth: '0.0005'});
      if (ps >= 400) return push('withdraw', {label: 'Withdraw with passkey', ok: false, body: prep});
      const {input, challenge, credentialId} = prep as {input: unknown; challenge: string; credentialId: string};
      const assertion = await withTimeout(startAuthentication({
        optionsJSON: {
          challenge,
          allowCredentials: [{id: credentialId, type: 'public-key'}] as never,
          rpId: location.hostname,
          userVerification: 'required',
          timeout: 60000
        } as never
      }));
      const {status, body} = await api('/api/withdraw/execute', {
        input,
        webauthn: {
          signature: assertion.response.signature,
          authenticatorData: assertion.response.authenticatorData,
          clientDataJSON: assertion.response.clientDataJSON
        }
      });
      push('withdraw', {label: 'Withdraw 0.0005 ETH with passkey', ok: status < 400, body});
    } catch (e) {
      push('withdraw', {label: 'Withdraw with passkey', ok: false, body: {error: (e as Error).message}});
    } finally {
      setBusy(null);
    }
  };

  const tradeDone = (results.trade ?? []).some((r) => r.ok);
  const breakDone = (results.break ?? []).filter((r) => (r.body as {denied?: boolean})?.denied).length >= 2;
  const withdrawDone = (results.withdraw ?? []).some((r) => r.ok);

  const stepState = (done: boolean, unlocked: boolean): 'done' | 'current' | 'locked' =>
    done ? 'done' : unlocked ? 'current' : 'locked';

  return (
    <div style={{marginTop: 8}}>
      <Step n={2} title="Place an order" why="Your backend trades for you instantly — no popups. The trading signer's policy only allows placeOrder calls to the exchange, capped at 0.01 ETH per order." state={stepState(tradeDone, true)}>
        <Btn testid="trade-ok" disabled={!!busy} onClick={() => run('trade', 'Place order 0.005 ETH', '/api/trade', {amountEth: '0.005'})}>
          {busy === 'Place order 0.005 ETH' ? 'Placing…' : 'Place order — 0.005 ETH'}
        </Btn>
        {(results.trade ?? []).map((r, i) => <ResultCard key={i} label={r.label} ok={r.ok} body={r.body} />)}
      </Step>

      <Step n={3} title="Now try to break it" why="Prove the backend can't steal funds: try an oversized order, then a plain withdrawal using the trading key. Privy's enclave must block both — the red cards are the point." state={stepState(breakDone, true)}>
        <Btn testid="trade-over-cap" kind="warn" disabled={!!busy} onClick={() => run('break', 'Order 0.02 ETH — over the policy cap', '/api/trade', {amountEth: '0.02'})}>
          Try an oversized order (0.02 ETH)
        </Btn>
        <Btn testid="rogue-withdraw" kind="danger" disabled={!!busy} onClick={() => run('break', 'Withdrawal with the trading key', '/api/withdraw/rogue', {to: withdrawTo, amountEth: '0.001'})}>
          Try withdrawing with the trading key
        </Btn>
        {(results.break ?? []).map((r, i) => <ResultCard key={i} label={r.label} ok={r.ok} body={r.body} />)}
      </Step>

      <Step n={4} title="Register your passkey" why="Withdrawals require a second signer: you plus your device's biometrics (Touch ID / Face ID). This registers your passkey's key with Privy as the withdrawal quorum." state={hasPasskey ? 'done' : 'current'}>
        {!hasPasskey && (
          <Btn testid="register-passkey" disabled={!!busy} onClick={registerPasskey}>
            {busy === 'passkey' ? 'Waiting for Touch ID / Face ID…' : '🔐 Register passkey'}
          </Btn>
        )}
        {(results.passkey ?? []).map((r, i) => <ResultCard key={i} label={r.label} ok={r.ok} body={r.body} />)}
      </Step>

      <Step n={5} last title="Withdraw — the right way" why="Your passkey signs the actual withdrawal request, so the signature can't be reused for anything else. This is the only path that can move funds out." state={stepState(withdrawDone, hasPasskey)}>
        <label style={{fontSize: 12, color: 'var(--muted)'}}>Destination address</label>
        <input
          data-testid="withdraw-to"
          value={withdrawTo}
          onChange={(e) => setWithdrawTo(e.target.value)}
          placeholder="0x…"
          style={{width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12}}
        />
        <Btn testid="withdraw-passkey" disabled={!!busy} onClick={withdrawWithPasskey}>
          {busy === 'withdraw' ? 'Confirm with your passkey…' : '🔐 Withdraw 0.0005 ETH'}
        </Btn>
        {(results.withdraw ?? []).map((r, i) => <ResultCard key={i} label={r.label} ok={r.ok} body={r.body} />)}
      </Step>
    </div>
  );
}
