import {describe, it, expect} from 'vitest';
import {basePolicy, tradingPolicy, withdrawalPolicy} from '../lib/policies';
import {EXCHANGE_ADDRESS} from '../lib/exchange';

describe('policies', () => {
  it('base policy allows only personal_sign', () => {
    const p = basePolicy();
    expect(p.rules).toHaveLength(1);
    expect(p.rules[0].method).toBe('personal_sign');
    expect(p.rules[0].action).toBe('ALLOW');
    expect(p.rules.some((r) => r.method.includes('Transaction'))).toBe(false);
  });

  it('trading policy pins to exchange with 0.01 ETH cap on both methods', () => {
    const p = tradingPolicy(EXCHANGE_ADDRESS);
    const methods = p.rules.map((r) => r.method).sort();
    expect(methods).toEqual(['eth_sendTransaction', 'eth_signTransaction']);
    for (const r of p.rules) {
      expect(r.action).toBe('ALLOW');
      expect(r.conditions).toContainEqual({
        field_source: 'ethereum_transaction',
        field: 'to',
        operator: 'eq',
        value: EXCHANGE_ADDRESS
      });
      const cap = r.conditions.find((c) => c.field === 'placeOrder.amountIn');
      expect(cap).toMatchObject({
        field_source: 'ethereum_calldata',
        operator: 'lte',
        value: '10000000000000000'
      });
      expect(cap?.abi).toBeDefined();
    }
  });

  it('withdrawal policy allows sends pinned only to Base Sepolia', () => {
    const p = withdrawalPolicy();
    expect(p.rules.length).toBeGreaterThan(0);
    for (const r of p.rules) {
      expect(r.action).toBe('ALLOW');
      // Privy requires >=1 condition on tx methods; chain pin is the only constraint
      expect(r.conditions).toEqual([
        {field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: '84532'}
      ]);
    }
  });

  it('no policy contains DENY rules (default-deny structure)', () => {
    for (const p of [basePolicy(), tradingPolicy(EXCHANGE_ADDRESS), withdrawalPolicy()]) {
      expect(p.rules.some((r) => r.action === 'DENY')).toBe(false);
    }
  });
});
