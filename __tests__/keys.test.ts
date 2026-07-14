import {it, expect} from 'vitest';
import {generateP256Keypair} from '../lib/keys';
import {createPublicKey} from 'node:crypto';

it('generates a P-256 keypair with base64-DER public key', () => {
  const {privateKeyPem, publicKeyBase64Der} = generateP256Keypair();
  expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
  const pub = createPublicKey({
    key: Buffer.from(publicKeyBase64Der, 'base64'),
    format: 'der',
    type: 'spki'
  });
  expect(pub.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
});
