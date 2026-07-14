/**
 * E2E verification of the Signer 2 (passkey) withdrawal path using a
 * SOFTWARE passkey: a locally generated P-256 key producing genuine
 * WebAuthn-formatted assertions (authenticatorData + clientDataJSON +
 * DER signature). Exercises the exact server/Privy mechanics of the real
 * flow — only the browser Touch ID ceremony is emulated.
 *
 * Usage: npx tsx scripts/verify-withdrawal.ts <privy-access-token>
 *
 * Verifies:
 *  1. quorum {user, passkey-key} threshold 2 can be attached as a signer
 *     with the withdrawal override policy (owner-authorized wallet update)
 *  2. user JWT sig + webauthn sig together satisfy the quorum → policy
 *     ALLOWS the withdrawal (eth_signTransaction, no funds needed)
 *  3. user JWT sig ALONE fails the 2-of-2 threshold → request rejected
 */
import {readFileSync} from 'node:fs';
import {createHash, createSign, generateKeyPairSync} from 'node:crypto';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && m[2] !== '') process.env[m[1]] ??= m[2];
}

const accessToken = process.argv[2];
if (!accessToken) {
  console.error('Usage: npx tsx scripts/verify-withdrawal.ts <privy-access-token>');
  process.exit(1);
}

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

async function main() {
  const {getPrivy, authKeyFromEnv, requiredEnv} = await import('../lib/privy');
  const {generateAuthorizationSignatures, formatRequestForAuthorizationSignature} = await import('@privy-io/node');

  const users = JSON.parse(readFileSync('data/users.json', 'utf8'));
  const rec = Object.values(users)[0] as {
    userId: string;
    walletId: string;
    tradingQuorumId: string;
  };
  console.log(`wallet ${rec.walletId} user ${rec.userId}`);

  const privy = getPrivy();

  // 1. Software passkey + quorum + signer attachment (owner-authorized)
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'P-256'});
  const passkeyPub = publicKey.export({type: 'spki', format: 'der'}).toString('base64');

  const quorum = await privy.keyQuorums().create({
    display_name: `verify-withdrawal:${rec.userId.slice(-12)}`,
    user_ids: [rec.userId],
    public_keys: [passkeyPub],
    authorization_threshold: 2
  });
  console.log(`✓ created signer-2 quorum ${quorum.id} (user + software passkey, 2-of-2)`);

  await privy.wallets().update(rec.walletId, {
    additional_signers: [
      {signer_id: rec.tradingQuorumId, override_policy_ids: [requiredEnv('PRIVY_TRADING_POLICY_ID')]},
      {signer_id: quorum.id, override_policy_ids: [requiredEnv('PRIVY_WITHDRAWAL_POLICY_ID')]}
    ],
    authorization_context: {
      authorization_private_keys: [authKeyFromEnv('PRIVY_OWNER_KEY_PRIVATE')],
      user_jwts: [accessToken]
    }
  });
  console.log('✓ attached signer 2 via owner-authorized wallet update (OWNER key + user JWT)');

  // 2. Canonical withdrawal request → WebAuthn assertion → submit
  const input = {
    version: 1 as const,
    method: 'POST' as const,
    url: `https://api.privy.io/v1/wallets/${rec.walletId}/rpc`,
    body: {
      method: 'eth_signTransaction',
      params: {
        transaction: {
          to: '0x000000000000000000000000000000000000dEaD',
          value: '0x38d7ea4c68000', // 0.001 ETH
          chain_id: 84532,
          gas_limit: '0x5208',
          nonce: 0,
          type: 2,
          max_fee_per_gas: '0x5f5e100',
          max_priority_fee_per_gas: '0x5f5e100'
        }
      }
    },
    headers: {'privy-app-id': process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
  };

  const challenge = b64url(formatRequestForAuthorizationSignature(input));

  const clientDataJSON = Buffer.from(
    JSON.stringify({type: 'webauthn.get', challenge, origin: 'http://localhost:3001', crossOrigin: false})
  );
  const authenticatorData = Buffer.concat([
    createHash('sha256').update('localhost').digest(), // rpIdHash
    Buffer.from([0x05]), // flags: UP | UV
    Buffer.from([0, 0, 0, 0]) // signCount
  ]);
  const signedPayload = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  const signature = createSign('sha256').update(signedPayload).sign({key: privateKey, dsaEncoding: 'der'});
  const webauthnSig = `webauthn:${b64url(authenticatorData)}:${b64url(clientDataJSON)}:${b64url(signature)}`;

  const userSigs = await generateAuthorizationSignatures(privy, {
    authorizationContext: {user_jwts: [accessToken]},
    input
  });
  console.log(`✓ computed user signature from JWT (${userSigs.length}) + webauthn assertion`);

  const submit = (sigs: string[]) =>
    fetch(input.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'privy-app-id': process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
        Authorization: `Basic ${Buffer.from(
          `${process.env.NEXT_PUBLIC_PRIVY_APP_ID}:${process.env.PRIVY_APP_SECRET}`
        ).toString('base64')}`,
        'privy-authorization-signature': sigs.join(',')
      },
      body: JSON.stringify(input.body)
    }).then(async (r) => ({status: r.status, body: await r.json()}));

  const full = await submit([...userSigs, webauthnSig]);
  console.log(`\n[user JWT + passkey] status ${full.status}:`, JSON.stringify(full.body).slice(0, 300));

  const partial = await submit(userSigs);
  console.log(`\n[user JWT only] status ${partial.status}:`, JSON.stringify(partial.body).slice(0, 300));

  const pass = full.status === 200 && partial.status !== 200;
  console.log(
    pass
      ? '\nPASS: withdrawal signed with full quorum; rejected below threshold.'
      : '\nFAIL: unexpected outcome — inspect above.'
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('verify-withdrawal failed:', e?.message ?? e);
  if (e?.error) console.error('API error body:', JSON.stringify(e.error, null, 2));
  process.exit(1);
});
