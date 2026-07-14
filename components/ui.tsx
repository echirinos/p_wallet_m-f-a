'use client';

export function Card({children}: {children: React.ReactNode}) {
  return (
    <div style={{background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 14}}>
      {children}
    </div>
  );
}

export function Mono({children}: {children: React.ReactNode}) {
  return <span style={{fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all'}}>{children}</span>;
}

export function Btn({onClick, disabled, kind = 'primary', testid, children}: {
  onClick: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'warn' | 'danger' | 'ghost';
  testid?: string;
  children: React.ReactNode;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {background: 'var(--accent)', color: 'var(--accent-ink)', border: '1px solid var(--accent)'},
    warn: {background: 'none', color: 'var(--amber)', border: '1px solid rgba(251,191,36,.45)'},
    danger: {background: 'none', color: 'var(--red)', border: '1px solid rgba(248,113,113,.45)'},
    ghost: {background: 'none', color: 'var(--muted)', border: '1px solid var(--border)'}
  };
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      style={{width: '100%', padding: '12px 14px', borderRadius: 10, fontWeight: 600, fontSize: 14, opacity: disabled ? 0.45 : 1, transition: 'opacity .15s', ...styles[kind]}}
    >
      {children}
    </button>
  );
}

/**
 * Every action resolves to a stamped verdict: SIGNED (the enclave produced a
 * signature) or REFUSED (the policy engine denied it). Denials are the demo —
 * the verbatim error is always shown, terminal-style.
 */
export function ResultCard({label, ok, body}: {label: string; ok: boolean; body: unknown}) {
  const b = body as {
    denied?: boolean;
    mode?: string;
    note?: string;
    error?: string;
    privyError?: {message?: string; code?: string};
    result?: {data?: {hash?: string}};
    hash?: string;
  };
  const denied = b?.denied === true;
  const hash = b?.hash ?? b?.result?.data?.hash;
  const verdict = denied ? 'refused' : ok ? 'signed' : 'error';

  return (
    <div
      data-testid="result"
      className="result-enter"
      style={{background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12}}
    >
      {denied && <div className="hazard" />}
      <p style={{fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
        <span className={`chip ${verdict === 'signed' ? 'chip-ok' : 'chip-no'}`}>
          {verdict === 'signed' ? 'signed ✓' : verdict === 'refused' ? 'refused' : 'error'}
        </span>
        <span style={{fontWeight: 600}}>{label}</span>
      </p>

      {denied && b?.privyError?.message && (
        <div className="term term-refused" style={{marginTop: 8}}>
          {`privy › ${b.privyError.message}\ncode  › ${b.privyError.code ?? 'policy_violation'}`}
        </div>
      )}
      {!denied && b?.note && <p style={{fontSize: 12, color: 'var(--muted)', marginTop: 6}}>{b.note}</p>}
      {!denied && !ok && b?.error && <div className="term" style={{marginTop: 8}}>{b.error}</div>}
      {hash && (
        <p style={{fontSize: 12, marginTop: 6}}>
          <a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" style={{color: 'var(--accent)'}}>
            View on BaseScan ↗
          </a>
        </p>
      )}
      <details style={{marginTop: 8}}>
        <summary style={{fontSize: 11, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'var(--mono)'}}>
          raw response
        </summary>
        <div className="term" style={{marginTop: 6, maxHeight: 220, overflowY: 'auto'}}>
          {JSON.stringify(body, null, 2)}
        </div>
      </details>
    </div>
  );
}
