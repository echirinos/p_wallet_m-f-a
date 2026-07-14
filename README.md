# Privy Secure Trading Wallets — Working Demo + Integration Guide

This repo is a **working demo** of a trading-wallet security architecture built on
[Privy](https://privy.io), plus the integration guide to reproduce it. Order placement stays
one-tap fast, but moving funds out is cryptographically impossible without the user's passkey —
even if the app's servers or database are fully compromised.

In this model:

- Each wallet is **owned by a 2-of-2 key quorum** of the user and the app's backend — neither party alone can change wallet controls, export keys, or move funds
- The backend **places orders through a scoped trading signer** that only works while the user holds an active session — when the session expires (configurable, e.g. 24 hours), trading stops arithmetically, not by convention
- **Withdrawals execute only through a second signer quorum of the user + their passkey**, with the passkey signing the withdrawal request itself
- Privy evaluates all wallet policies **inside secure enclaves at signing time** — if a request violates policy, the enclave refuses to sign

> Every claim below was captured live against the Privy API (July 2026, `@privy-io/node` 0.26.x);
> see [`docs/verification.md`](./docs/verification.md) for verbatim captures. Guide examples use
> Base mainnet (`8453`); this demo runs the identical flow on Base Sepolia (`84532`).

## Try the demo

**Live: https://p-wallet-mfa.vercel.app** — log in with any email, and the app provisions a
wallet with the full quorum/policy architecture for you. Place orders, watch the policy engine
block a rogue withdrawal, then register a passkey (Touch ID / Face ID) and withdraw properly.
The page is a guided five-step flow — just follow the numbers.

**Local:**

```bash
git clone https://github.com/echirinos/p_wallet_m-f-a.git && cd p_wallet_m-f-a
npm install
cp .env.example .env.local        # add your Privy app ID + secret
npm run provision                 # generates backend P-256 keys + creates the 3 policies
npm run dev                       # open the printed localhost URL and log in
```

The demo wallet starts unfunded: orders run in sign-only mode (policy results are identical).
Fund the displayed address from a [Base Sepolia faucet](https://portal.cdp.coinbase.com/products/faucet)
to broadcast for real.

## Overview — three authority levels on one wallet

| Role | Who signs (2-of-2 quorum) | What policy allows | In this repo |
|---|---|---|---|
| **Owner** | User + backend owner key | Admin + message signing only — **no transfer rules → withdrawals default-DENIED** | [`app/api/provision/route.ts`](./app/api/provision/route.ts) |
| **Signer 1 — Trading** | Backend trading key + user session (JWT) | `placeOrder(...)` to one exchange contract, amount ≤ 0.01 ETH (ABI-decoded) | [`app/api/trade/route.ts`](./app/api/trade/route.ts) |
| **Signer 2 — Withdrawal** | User + user's passkey | Transfers out | [`app/api/withdraw/`](./app/api/withdraw/) |

This enables:

- **Withdrawal protection by construction** — a compromised backend holds no combination of keys that satisfies any withdrawal-capable quorum
- **Instant, popup-free trading** while the user's session is live
- **Biometric confirmation** on every withdrawal
- **Tamper observability** — every blocked attempt returns a structured `policy_violation` you can alert on

The one-page demo UI ([`app/page.tsx`](./app/page.tsx), [`components/Acts.tsx`](./components/Acts.tsx))
walks these as three acts: live architecture panel → orders (allowed / policy-capped) →
withdrawal (blocked via trading signer, allowed via passkey).

## 1. Install the SDK

```bash
npm install @privy-io/node @privy-io/react-auth @simplewebauthn/server @simplewebauthn/browser cose-to-jwk viem
```

## 2. Initialize the Privy client

*In this repo: [`lib/privy.ts`](./lib/privy.ts)*

```ts
import {PrivyClient} from '@privy-io/node';

const privy = new PrivyClient({
  appId: 'your-privy-app-id',
  appSecret: 'your-privy-app-secret',
});
```

Retrieve your app ID and app secret from the [Privy Dashboard](https://dashboard.privy.io).

## 3. Generate the backend authorization keys

*In this repo: [`lib/keys.ts`](./lib/keys.ts), run by [`scripts/provision.ts`](./scripts/provision.ts)*

Two P-256 keys with distinct duties — never share one key across roles:

- **Owner key** — co-signs admin actions only. Store in your KMS/HSM.
- **Trading key** — hot key used per order. Store in your secret manager, rotated.

```ts
import {generateKeyPairSync} from 'node:crypto';

const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'P-256'});
const privatePkcs8Pem = privateKey.export({type: 'pkcs8', format: 'pem'});                    // keep secret
const publicBase64Der = publicKey.export({type: 'spki', format: 'der'}).toString('base64');   // register with Privy
```

When passing private keys to the SDK's `authorization_context`, use the base64 PKCS8 body with
the PEM armor stripped (see `authKeyFromEnv` in [`lib/privy.ts`](./lib/privy.ts)).

## 4. Create the three policies (once per app)

*Privy Documentation — https://docs.privy.io/controls/policies/create-a-policy*
*In this repo: [`lib/policies.ts`](./lib/policies.ts) (unit-tested in [`__tests__/policies.test.ts`](./__tests__/policies.test.ts)), created by [`scripts/provision.ts`](./scripts/provision.ts)*

Policies are evaluated inside Privy's secure enclave at signing time. Two design rules matter:

- **Block by absence of ALLOW, never with DENY rules.** DENY takes precedence across the whole
  evaluation, so a DENY on the base policy would override the withdrawal signer's permissions.
- Every transaction-method rule **must contain at least one condition** — the API rejects
  empty-condition rules with `invalid_policy_format`.

```ts
// 4a. Base policy — attached to the wallet, governs the owner path.
//     No transfer rules → withdrawals are structurally impossible by default.
const basePolicy = await privy.policies().create({
  version: '1.0',
  chain_type: 'ethereum',
  name: 'Base wallet policy — no transfers',
  rules: [
    {name: 'Allow message signing', method: 'personal_sign', action: 'ALLOW', conditions: []},
  ],
});

// 4b. Trading policy — override policy for Signer 1.
const tradingPolicy = await privy.policies().create({
  version: '1.0',
  chain_type: 'ethereum',
  name: 'Trading signer — order placement only',
  rules: ['eth_sendTransaction', 'eth_signTransaction'].map((method) => ({
    name: `Orders via ${method}`,
    method,
    action: 'ALLOW',
    conditions: [
      // Must target the exchange contract
      {field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: EXCHANGE_ADDRESS},
      // Calldata must decode to placeOrder with amountIn under the cap
      {
        field_source: 'ethereum_calldata',
        field: 'placeOrder.amountIn',
        abi: EXCHANGE_ABI, // your contract's ABI as JSON — Privy decodes calldata in the enclave
        operator: 'lte',
        value: '10000000000000000', // 0.01 ETH
      },
    ],
  })),
});

// 4c. Withdrawal policy — override policy for Signer 2.
const withdrawalPolicy = await privy.policies().create({
  version: '1.0',
  chain_type: 'ethereum',
  name: 'Withdrawal signer — passkey-gated transfers',
  rules: ['eth_sendTransaction', 'eth_signTransaction'].map((method) => ({
    name: `Withdraw via ${method}`,
    method,
    action: 'ALLOW',
    conditions: [
      // Chain pin satisfies the >=1-condition requirement; production should add
      // destination allowlists (in_condition_set) and per-withdrawal caps.
      {field_source: 'ethereum_transaction', field: 'chain_id', operator: 'eq', value: '8453'},
    ],
  })),
});
```

The exchange contract address and `placeOrder` ABI used by the demo live in
[`lib/exchange.ts`](./lib/exchange.ts).

## 5. Provision each user's wallet (at signup)

*Privy Documentation — https://docs.privy.io/controls/quorum-approvals/overview*
*In this repo: [`app/api/provision/route.ts`](./app/api/provision/route.ts)*

Two key quorums per user, then the wallet:

```ts
// Owner quorum: the user AND your owner key must both sign admin actions
const ownerQuorum = await privy.keyQuorums().create({
  display_name: `owner:${shortUserId}`, // display_name max 50 chars
  user_ids: [privyUserId],
  public_keys: [OWNER_KEY_PUBLIC],
  authorization_threshold: 2,
});

// Trading quorum: your trading key AND a live user session
const tradingQuorum = await privy.keyQuorums().create({
  display_name: `trading:${shortUserId}`,
  user_ids: [privyUserId],
  public_keys: [TRADING_KEY_PUBLIC],
  authorization_threshold: 2,
});

// The wallet: owner quorum + base policy + trading signer with its override policy
const wallet = await privy.wallets().create({
  chain_type: 'ethereum',
  owner_id: ownerQuorum.id,
  policy_ids: [basePolicy.id],
  additional_signers: [
    {signer_id: tradingQuorum.id, override_policy_ids: [tradingPolicy.id]},
  ],
});
```

Persist `wallet.id`, `wallet.address`, and both quorum IDs against the user. This demo stores
them as **Privy user custom metadata** ([`lib/store.ts`](./lib/store.ts)) so it needs no
database and runs on serverless hosts; production would use your own DB.

## 6. Place orders through the trading signer

*In this repo: [`app/api/trade/route.ts`](./app/api/trade/route.ts)*

The backend signs with the trading key; the user's approval is their current Privy access token,
passed as `user_jwts`. No wallet popups — the policy is enforced inside the enclave.

```ts
const response = await privy.wallets().ethereum().sendTransaction(wallet.id, {
  caip2: 'eip155:8453',
  params: {transaction: {to: EXCHANGE_ADDRESS, value: '0x0', data: placeOrderCalldata}},
  authorization_context: {
    authorization_private_keys: [TRADING_KEY_PKCS8_BASE64],
    user_jwts: [userAccessToken], // the user's quorum approval
  },
});
const txHash = response.hash;
```

**The "24 hr MFA" property:** the user is a quorum member; their signature is derived from their
JWT. An expired session means the 2-of-2 threshold cannot be met — trading stops without any code
on the app's side. Set session lifetime to 24 hours in the Privy Dashboard to match the design.
(Privy's separate native wallet-MFA feature — SMS/TOTP/passkey prompts with a 15-minute window —
is orthogonal and can be layered on top. If trading must continue while the user is offline,
switch Signer 1 to a 1-of-1 backend quorum and add a `system.current_unix_timestamp` deadline
condition refreshed on each login.)

## 7. What the policy engine blocks

*In this repo: [`app/api/withdraw/rogue/route.ts`](./app/api/withdraw/rogue/route.ts) deliberately attempts this; [`lib/privy-errors.ts`](./lib/privy-errors.ts) surfaces the raw error*

An order over the calldata cap, and a plain transfer attempted with the trading signer — both
rejected by the enclave with the same structured error (verbatim capture):

```json
{"error": "RPC request denied due to policy violation", "code": "policy_violation"}
```

Alert on `policy_violation` in production: it is either a tamper attempt or a bug, never normal
operation.

## 8. Register the user's passkey as the withdrawal signer

*Privy Documentation — https://docs.privy.io/recipes/passkey-server-wallets*
*In this repo: [`app/api/passkey/register/begin/route.ts`](./app/api/passkey/register/begin/route.ts) and [`verify/route.ts`](./app/api/passkey/register/verify/route.ts); conversion helper in [`lib/passkey.ts`](./lib/passkey.ts)*

Run a standard WebAuthn registration (ES256/P-256 only — the same curve as Privy authorization
keys). The credential's public key arrives in COSE format; Privy expects base64-encoded DER/SPKI:

```ts
import {createPublicKey} from 'node:crypto';
const coseToJwk = require('cose-to-jwk');

function coseToBase64Der(cosePublicKey: Uint8Array): string {
  const jwk = coseToJwk(cosePublicKey);                          // COSE → JWK
  const key = createPublicKey({key: jwk, format: 'jwk'});        // JWK → KeyObject
  return key.export({type: 'spki', format: 'der'}).toString('base64'); // → base64 DER
}

// With @simplewebauthn/server after verifyRegistrationResponse:
const {credential} = verification.registrationInfo;
const passkeyPublicKeyBase64Der = coseToBase64Der(credential.publicKey);
```

Then register it in a quorum with the user and attach it as a signer:

```ts
const passkeyQuorum = await privy.keyQuorums().create({
  display_name: `withdrawal:${shortUserId}`,
  user_ids: [privyUserId],
  public_keys: [passkeyPublicKeyBase64Der],
  authorization_threshold: 2,
});

// Adding a signer is an ADMIN action → the OWNER quorum authorizes it.
// NOTE: additional_signers REPLACES the list — restate the trading signer.
await privy.wallets().update(wallet.id, {
  additional_signers: [
    {signer_id: tradingQuorum.id, override_policy_ids: [tradingPolicy.id]},
    {signer_id: passkeyQuorum.id, override_policy_ids: [withdrawalPolicy.id]},
  ],
  authorization_context: {
    authorization_private_keys: [OWNER_KEY_PKCS8_BASE64],
    user_jwts: [userAccessToken],
  },
});
```

## 9. Withdraw with user + passkey

*In this repo: [`app/api/withdraw/prepare/route.ts`](./app/api/withdraw/prepare/route.ts) → passkey ceremony in [`components/Acts.tsx`](./components/Acts.tsx) → [`app/api/withdraw/execute/route.ts`](./app/api/withdraw/execute/route.ts)*

The core mechanic: **the WebAuthn challenge is the canonicalized Privy request itself**, so the
passkey signature is bound to exactly one withdrawal — a stolen session or database cannot
fabricate one, and no signature can be replayed.

**Server — build the request, derive the challenge:**

```ts
import {formatRequestForAuthorizationSignature} from '@privy-io/node';

const input = {
  version: 1,
  method: 'POST',
  url: `https://api.privy.io/v1/wallets/${wallet.id}/rpc`,
  body: {
    method: 'eth_sendTransaction',
    caip2: 'eip155:8453',
    params: {transaction: {to: destination, value: amountHex}},
  },
  headers: {'privy-app-id': APP_ID},
};
const challenge = Buffer.from(formatRequestForAuthorizationSignature(input)).toString('base64url');
```

**Client — the passkey ceremony (Touch ID / Face ID):**

```ts
import {startAuthentication} from '@simplewebauthn/browser';

const assertion = await startAuthentication({
  optionsJSON: {
    challenge,
    allowCredentials: [{id: credentialId, type: 'public-key'}],
    rpId: location.hostname,
    userVerification: 'required',
  },
});
// Send assertion.response.{signature, authenticatorData, clientDataJSON} to the server.
```

**Server — combine both quorum signatures and submit:**

```ts
import {generateAuthorizationSignatures} from '@privy-io/node';

// The user's signature, derived from their JWT via Privy's user-key exchange
const userSigs = await generateAuthorizationSignatures(privy, {
  authorizationContext: {user_jwts: [userAccessToken]},
  input,
});

// The passkey's signature, in Privy's WebAuthn header format (all parts base64url)
const webauthnSig = `webauthn:${authenticatorData}:${clientDataJSON}:${signature}`;

await fetch(input.url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'privy-app-id': APP_ID,
    Authorization: `Basic ${Buffer.from(`${APP_ID}:${APP_SECRET}`).toString('base64')}`,
    'privy-authorization-signature': [...userSigs, webauthnSig].join(','),
  },
  body: JSON.stringify(input.body), // MUST be byte-identical to what was canonicalized
});
```

Observed live (captured with `eth_signTransaction` on an unfunded test wallet — broadcasting via
`eth_sendTransaction` is the same call with a funded wallet):

- User JWT + passkey signatures → **200, Privy returned the signed transaction**
- User JWT alone → 401: `"Number of signatures in 'privy-authorization-signature' header does not
  match the wallet's authorization threshold."`

You can re-run this proof yourself: `npx tsx scripts/verify-withdrawal.ts <privy-access-token>`
([`scripts/verify-withdrawal.ts`](./scripts/verify-withdrawal.ts) uses a software P-256 passkey
emitting genuine WebAuthn assertions).

## 10. Production hardening checklist

- [ ] Owner key in an HSM/KMS (AWS KMS supports P-256 signing); trading key in your secret manager with rotation — never in env files
- [ ] Set **owners on the policies themselves** (`owner_id` at creation) so policy edits also require quorum signatures; without an owner, your app secret alone can rewrite them
- [ ] Tighten the withdrawal policy: destination allowlist (`in_condition_set` of user-verified addresses), per-transaction value caps, velocity limits at the API layer
- [ ] Multiple passkeys per user + a recovery flow (re-run step 8's owner-authorized update with a revised quorum)
- [ ] Replace the custom-metadata store with your own database
- [ ] Idempotency keys (`privy-idempotency-key`) on wallet and quorum creation
- [ ] Alert on every `policy_violation` response

## Repo map

| Path | What |
|---|---|
| `lib/policies.ts` | The three policy definitions (unit-tested) |
| `lib/exchange.ts` | Demo exchange address + `placeOrder` ABI/calldata |
| `lib/privy.ts` | Privy client, chain constants, key helpers |
| `lib/store.ts` | User → wallet mapping via Privy custom metadata (no DB) |
| `lib/passkey.ts` | COSE→DER conversion + stateless challenge tokens |
| `scripts/provision.ts` | One-time app setup: keys + policies |
| `scripts/verify-withdrawal.ts` | Live E2E proof of the passkey withdrawal quorum |
| `app/api/*` | The six API routes (provision, wallet, trade, rogue, passkey, withdraw) |
| `app/page.tsx`, `components/` | Three-act demo UI |
| `docs/verification.md` | Verbatim live-API captures backing every claim |

## Tests

```bash
npm test   # unit tests: policy shapes, calldata round-trip, key formats
```
