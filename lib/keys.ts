import {generateKeyPairSync} from 'node:crypto';

/**
 * Generate a P-256 keypair in the formats Privy expects:
 * - private key: PKCS8 PEM (used in authorization_context.authorization_private_keys)
 * - public key: base64-encoded DER/SPKI (used when registering keys/quorums)
 */
export function generateP256Keypair() {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve: 'P-256'});
  return {
    privateKeyPem: privateKey.export({type: 'pkcs8', format: 'pem'}).toString(),
    publicKeyBase64Der: publicKey.export({type: 'spki', format: 'der'}).toString('base64')
  };
}
