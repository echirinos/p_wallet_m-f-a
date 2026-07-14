import {PrivyClient} from '@privy-io/node';

let client: PrivyClient | undefined;

export function getPrivy() {
  client ??= new PrivyClient({
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!
  });
  return client;
}

/** Base Sepolia */
export const CAIP2 = 'eip155:84532';
export const CHAIN_ID = 84532;

/** Read a PEM private key stored single-line in an env var (\n-escaped). */
export function pemFromEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — run \`npm run provision\` first`);
  return v.replace(/\\n/g, '\n');
}

/**
 * Authorization keys for Privy authorization contexts: base64-encoded PKCS8
 * with no PEM armor (the base64 body of the PKCS8 PEM).
 */
export function authKeyFromEnv(name: string): string {
  return pemFromEnv(name)
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} — run \`npm run provision\` first`);
  return v;
}
