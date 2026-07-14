/**
 * App-level provisioning (run once): generates the two backend P-256
 * authorization keys and creates the three app-wide policies.
 *
 * Idempotent: any value already present in .env.local is left untouched.
 * Results are appended to .env.local.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {generateP256Keypair} from '../lib/keys';
import {basePolicy, tradingPolicy, withdrawalPolicy} from '../lib/policies';
import {EXCHANGE_ADDRESS} from '../lib/exchange';

const ENV_PATH = resolve(process.cwd(), '.env.local');

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) throw new Error('.env.local not found');
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[2] !== '') env[m[1]] = m[2];
  }
  return env;
}

function appendEnv(vars: Record<string, string>) {
  const additions = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(ENV_PATH, readFileSync(ENV_PATH, 'utf8').trimEnd() + '\n' + additions + '\n');
}

async function main() {
  const env = loadEnv();
  Object.assign(process.env, env);
  const {getPrivy} = await import('../lib/privy');
  const privy = getPrivy();
  const added: Record<string, string> = {};

  // 1. Backend keys (owner/admin key + hot trading key)
  for (const role of ['OWNER', 'TRADING'] as const) {
    const privVar = `PRIVY_${role}_KEY_PRIVATE`;
    const pubVar = `PRIVY_${role}_KEY_PUBLIC`;
    if (env[privVar] && env[pubVar]) {
      console.log(`✓ ${role} key already present`);
      continue;
    }
    const {privateKeyPem, publicKeyBase64Der} = generateP256Keypair();
    added[privVar] = privateKeyPem.replace(/\n/g, '\\n');
    added[pubVar] = publicKeyBase64Der;
    console.log(`+ generated ${role} P-256 key`);
  }

  // 2. App-wide policies
  const policyPlans = [
    {envVar: 'PRIVY_BASE_POLICY_ID', body: basePolicy()},
    {envVar: 'PRIVY_TRADING_POLICY_ID', body: tradingPolicy(EXCHANGE_ADDRESS)},
    {envVar: 'PRIVY_WITHDRAWAL_POLICY_ID', body: withdrawalPolicy()}
  ];
  for (const {envVar, body} of policyPlans) {
    if (env[envVar]) {
      console.log(`✓ ${envVar} already present (${env[envVar]})`);
      continue;
    }
    const policy = await privy.policies().create(body as never);
    added[envVar] = policy.id;
    console.log(`+ created policy "${body.name}" → ${policy.id}`);
  }

  if (Object.keys(added).length) {
    appendEnv(added);
    console.log(`\nWrote ${Object.keys(added).length} value(s) to .env.local`);
  } else {
    console.log('\nNothing to do — fully provisioned.');
  }
  console.log(`Exchange address (policy-pinned): ${EXCHANGE_ADDRESS}`);
}

main().catch((e) => {
  console.error('Provisioning failed:', e?.message ?? e);
  if (e?.error) console.error('API error body:', JSON.stringify(e.error, null, 2));
  process.exit(1);
});
