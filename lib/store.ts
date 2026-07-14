import {getPrivy} from './privy';

/**
 * User → wallet mapping stored as Privy user custom metadata, so the demo
 * needs no database and runs identically on localhost and serverless hosts
 * (Vercel's filesystem is ephemeral). Production equivalent: your own DB.
 */

export type UserRecord = {
  userId: string;
  walletId: string;
  address: string;
  ownerQuorumId: string;
  tradingQuorumId: string;
  passkey?: {
    credentialId: string;
    publicKeyPem: string;
    quorumId: string;
  };
};

const METADATA_KEY = 'trading_demo';

export async function getUser(userId: string): Promise<UserRecord | null> {
  // _get = fetch-by-user-ID (the service's `get` variant takes an id_token)
  const user = await getPrivy().users()._get(userId);
  const raw = (user.custom_metadata as Record<string, unknown> | undefined)?.[METADATA_KEY];
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as UserRecord;
  } catch {
    return null;
  }
}

export async function mustGetUser(userId: string): Promise<UserRecord> {
  const rec = await getUser(userId);
  if (!rec) throw new Error(`No wallet provisioned for this user — call /api/provision first`);
  return rec;
}

export async function saveUser(rec: UserRecord): Promise<void> {
  await getPrivy().users().setCustomMetadata(rec.userId, {
    custom_metadata: {[METADATA_KEY]: JSON.stringify(rec)}
  });
}
