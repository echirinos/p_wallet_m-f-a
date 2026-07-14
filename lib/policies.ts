import {EXCHANGE_ABI, MAX_ORDER_WEI} from './exchange';

/**
 * Policy builders returning Privy `POST /v1/policies` request bodies.
 *
 * Blocking is done by ABSENCE of ALLOW rules, never explicit DENY rules:
 * Privy's policy engine default-denies any method with no matching rule, and
 * DENY rules would take precedence across signer override policies.
 */

const TX_METHODS = ['eth_sendTransaction', 'eth_signTransaction'] as const;

type Condition = {
  field_source: string;
  field: string;
  operator: string;
  value: string;
  abi?: unknown;
};

export type PolicyRule = {
  name: string;
  method: string;
  action: 'ALLOW' | 'DENY';
  conditions: Condition[];
};

export type PolicyBody = {
  version: '1.0';
  chain_type: 'ethereum';
  name: string;
  rules: PolicyRule[];
};

/** Wallet-level policy (owner path): message signing only — no transfer rules. */
export function basePolicy(): PolicyBody {
  return {
    version: '1.0',
    chain_type: 'ethereum',
    name: 'Base wallet policy — no transfers (owner path)',
    rules: [{name: 'Allow message signing', method: 'personal_sign', action: 'ALLOW', conditions: []}]
  };
}

/**
 * Signer 1 override policy: transactions may only target the exchange
 * contract, and calldata must decode to placeOrder with amountIn <= cap.
 * eth_signTransaction mirrors eth_sendTransaction so the demo can show
 * policy results before the wallet is faucet-funded.
 */
export function tradingPolicy(exchange: string): PolicyBody {
  return {
    version: '1.0',
    chain_type: 'ethereum',
    name: 'Trading signer — order placement only',
    rules: TX_METHODS.map((method) => ({
      name: `Orders via ${method}`,
      method,
      action: 'ALLOW' as const,
      conditions: [
        {field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: exchange},
        {
          field_source: 'ethereum_calldata',
          field: 'placeOrder.amountIn',
          abi: EXCHANGE_ABI,
          operator: 'lte',
          value: MAX_ORDER_WEI.toString()
        }
      ]
    }))
  };
}

/**
 * Signer 2 override policy: transfers allowed, gated by the passkey quorum
 * itself. Privy requires >=1 condition on transaction methods, so the rule
 * pins withdrawals to Base Sepolia (production: destination allowlists/caps).
 */
export function withdrawalPolicy(): PolicyBody {
  return {
    version: '1.0',
    chain_type: 'ethereum',
    name: 'Withdrawal signer — passkey-gated transfers',
    rules: TX_METHODS.map((method) => ({
      name: `Withdraw via ${method}`,
      method,
      action: 'ALLOW' as const,
      conditions: [
        {field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: '84532'}
      ]
    }))
  };
}
