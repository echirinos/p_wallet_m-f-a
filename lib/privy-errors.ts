/**
 * Extract Privy's error body verbatim — denials are the demo, so the raw
 * policy-engine message must reach the UI untouched. Never a stack trace.
 */
export function privyErrorPayload(e: unknown): {message: string; code?: string; status?: number; raw?: unknown} {
  const err = e as {status?: number; error?: {error?: string; code?: string}; message?: string};
  if (err?.error && typeof err.error === 'object') {
    return {
      message: err.error.error ?? err.message ?? 'Unknown Privy error',
      code: err.error.code,
      status: err.status,
      raw: err.error
    };
  }
  return {message: err?.message ?? 'Unknown error', status: err?.status};
}

/** True if the error is the policy engine rejecting the request. */
export function isPolicyDenial(e: unknown): boolean {
  const p = privyErrorPayload(e);
  const text = `${p.message} ${p.code ?? ''}`.toLowerCase();
  return text.includes('policy') || text.includes('denied') || text.includes('violat');
}
