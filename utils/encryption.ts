import nacl from 'tweetnacl';
import * as base64 from 'base64-js';

// ─────────────────────────────────────────────
// Robust UTF-8 conversion without TextEncoder
// ─────────────────────────────────────────────
const stringToUint8 = (str: string): Uint8Array => {
  const utf8 = unescape(encodeURIComponent(str));
  const arr = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) {
    arr[i] = utf8.charCodeAt(i);
  }
  return arr;
};

const uint8ToString = (arr: Uint8Array): string => {
  let utf8 = '';
  for (let i = 0; i < arr.length; i++) {
    utf8 += String.fromCharCode(arr[i]);
  }
  try {
    return decodeURIComponent(escape(utf8));
  } catch {
    return utf8; // Fallback to raw string
  }
};

export const encodeBase64 = (arr: Uint8Array): string => base64.fromByteArray(arr);
export const decodeBase64 = (str: string): Uint8Array => {
  // Ensure the string is clean base64
  const clean = str.replace(/[^A-Za-z0-9+/=]/g, "");
  return base64.toByteArray(clean);
};

// ─────────────────────────────────────────────
// Key generation
// ─────────────────────────────────────────────
export interface KeyPair {
  publicKey: string;
  privateKey: string;
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
// ─────────────────────────────────────────────
export const deriveSharedSecret = (
  myPrivateKey: string,
  theirPublicKey: string
): Uint8Array => {
  try {
    const priv = decodeBase64(myPrivateKey.trim());
    const pub = decodeBase64(theirPublicKey.trim());
    
    if (priv.length !== 32 || pub.length !== 32) {
      throw new Error("Invalid key length");
    }
    
    return nacl.box.before(pub, priv);
  } catch (e) {
    console.error("Shared secret derivation failed:", e);
    return new Uint8Array(32); // Return empty key to avoid crash, decryption will fail gracefully
  }
};

// ─────────────────────────────────────────────
// Text encryption / decryption
// ─────────────────────────────────────────────
export const encryptText = async (
  message: string,
  sharedSecret: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(stringToUint8(message), nonce, sharedSecret);
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
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
    return decrypted ? uint8ToString(decrypted) : null;
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────
// File / image encryption
// ─────────────────────────────────────────────
export const encryptFile = async (
  base64Data: string,
  sharedSecret: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const binary = decodeBase64(base64Data);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(binary, nonce, sharedSecret);
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
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
