import nacl from 'tweetnacl';
import * as base64 from 'base64-js';

// ─────────────────────────────────────────────
// Conversion helpers
// ─────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

export const encodeBase64 = (arr: Uint8Array): string => base64.fromByteArray(arr);
export const decodeBase64 = (str: string): Uint8Array => base64.toByteArray(str);

// ─────────────────────────────────────────────
// Key generation
// ─────────────────────────────────────────────
export interface KeyPair {
  publicKey: string;  // base64
  privateKey: string; // base64
}

export const generateKeyPair = async (): Promise<KeyPair> => {
  const keys = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keys.publicKey),
    privateKey: encodeBase64(keys.secretKey),
  };
};

// ─────────────────────────────────────────────
// Shared secret derivation (ECDH)
// Alice & Bob compute the same 32-byte secret:
//   shared = ECDH(alicePriv, bobPub) == ECDH(bobPriv, alicePub)
// ─────────────────────────────────────────────
export const deriveSharedSecret = (
  myPrivateKey: string,
  theirPublicKey: string
): Uint8Array => {
  const priv = decodeBase64(myPrivateKey.trim());
  const pub  = decodeBase64(theirPublicKey.trim());
  // nacl.box.before = X25519 DH, returns the 32-byte HSalsa20 output
  return nacl.box.before(pub, priv);
};

// ─────────────────────────────────────────────
// Text encryption / decryption  (nacl.secretbox)
// Both sides derive the SAME sharedSecret, so
// encrypt(msg, secret) can always be
// decrypted with the same secret.
// ─────────────────────────────────────────────
export const encryptText = async (
  message: string,
  sharedSecret: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce     = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(enc.encode(message), nonce, sharedSecret);
  return {
    encrypted: encodeBase64(encrypted),
    nonce:     encodeBase64(nonce),
  };
};

export const decryptText = async (
  encryptedBase64: string,
  nonceBase64: string,
  sharedSecret: Uint8Array
): Promise<string | null> => {
  try {
    const decrypted = nacl.secretbox.open(
      decodeBase64(encryptedBase64),
      decodeBase64(nonceBase64),
      sharedSecret
    );
    return decrypted ? dec.decode(decrypted) : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────
// File / image encryption  (nacl.secretbox)
// ─────────────────────────────────────────────
export const encryptFile = async (
  base64Data: string,
  sharedSecret: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce     = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(decodeBase64(base64Data), nonce, sharedSecret);
  return {
    encrypted: encodeBase64(encrypted),
    nonce:     encodeBase64(nonce),
  };
};

export const decryptFile = async (
  encryptedBase64: string,
  nonceBase64: string,
  sharedSecret: Uint8Array
): Promise<string | null> => {
  try {
    const decrypted = nacl.secretbox.open(
      decodeBase64(encryptedBase64),
      decodeBase64(nonceBase64),
      sharedSecret
    );
    return decrypted ? encodeBase64(decrypted) : null;
  } catch {
    return null;
  }
};
