# Live verification captures (Base Sepolia, 2026-07-14)

Wallet: `0xc13FE72bD847767251c93A782722654bd073Bf50` (id `fna40v4vtoth38lcwvo5wm1j`)
Owner quorum: `jsxb6on64zxd2vuj2pxwlduo` (user + OWNER key, threshold 2)
Trading quorum: `dcnwl7afep36wvb0prh5c8or` (user + TRADING key, threshold 2)

## 1. Order within policy (0.005 ETH) — ALLOWED

`POST /api/trade {amountEth: "0.005"}` → signer = trading quorum (TRADING key + user JWT)

```json
{
  "ok": true,
  "mode": "sign-only",
  "note": "Wallet unfunded — policy ALLOWED the order and Privy signed it, but it was not broadcast.",
  "signedTransaction": "0x02f8f383014a34808405f5e1008405f5e10083030d409400000000000000000000000000000000000e2c4a80b884ac15e2f4...c001a04f10..."
}
```

Decoded: type-2 tx to `0x...0e2c4a` (exchange), calldata `placeOrder(0x0, 5000000000000000, 0, true)`.

## 2. Order over calldata cap (0.02 ETH) — DENIED

`POST /api/trade {amountEth: "0.02"}` — same signer. Privy response (verbatim):

```json
{"error": "RPC request denied due to policy violation", "code": "policy_violation"}
```

Proves the `ethereum_calldata` condition (`placeOrder.amountIn lte 0.01 ETH`, ABI-decoded) is enforced in the TEE.

## 3. Withdrawal via trading signer — DENIED

`POST /api/withdraw/rogue {to: 0x...dEaD, amountEth: "0.001"}` — same signer, plain value transfer:

```json
{"error": "RPC request denied due to policy violation", "code": "policy_violation"}
```

Proves the trading signer cannot move funds out: its override policy has no rule matching a plain transfer, and Privy default-denies.

## 4. Passkey withdrawal (Signer 2) — full quorum ALLOWED, partial DENIED

`scripts/verify-withdrawal.ts` (software P-256 passkey emitting genuine WebAuthn assertions):

- Quorum `{user, passkey}` threshold 2 created and attached as signer 2 with the withdrawal
  policy via owner-authorized wallet update (OWNER key + user JWT). ✓
- **user JWT sig + `webauthn:<authData>:<clientDataJSON>:<derSig>` header → 200**, Privy returned
  `signed_transaction` for the 0.001 ETH transfer. ✓
- **user JWT sig alone → 401**: `"Number of signatures in \`privy-authorization-signature\` header
  does not match the wallet's authorization threshold."` ✓

WebAuthn challenge = base64url(canonical request payload) via `formatRequestForAuthorizationSignature`,
so the passkey signs the transaction request itself (no replay for other requests).

## Environment notes

- `@privy-io/node` 0.26.0, `@privy-io/react-auth` 3.35.0
- Live-API discovery: policies reject transaction-method rules with zero conditions (`invalid_policy_format`) — the docs' "allow all" example no longer passes validation; withdrawal policy pins `chain_id eq 84532` instead.
- Quorum user approval = `user_jwts: [privy access token]` in `authorization_context`; worked first try for 2-of-2 {app key, user}.
