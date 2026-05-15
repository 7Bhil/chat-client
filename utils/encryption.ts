import nacl from 'tweetnacl';
import * as base64 from 'base64-js';

// Use TextEncoder/Decoder for reliable UTF-8 handling (Polyfilled in _layout.tsx)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encodeBase64 = (arr: Uint8Array): string => base64.fromByteArray(arr);

export const decodeBase64 = (str: string): Uint8Array => {
  if (!str || typeof str !== 'string') return new Uint8Array(0);
  try {
    // Clean string from any potential whitespace or non-base64 chars
    const clean = str.trim().replace(/[^A-Za-z0-9+/=]/g, "");
    return base64.toByteArray(clean);
  } catch (e) {
    console.error("Base64 Decode Error:", e);
    return new Uint8Array(0);
  }
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
// SHARED SECRET (X25519)
// ─────────────────────────────────────────────
export const deriveSharedSecret = (
  myPrivateKey: string,
  theirPublicKey: string
): Uint8Array => {
  try {
    const priv = decodeBase64(myPrivateKey);
    const pub = decodeBase64(theirPublicKey);
    
    if (priv.length !== 32 || pub.length !== 32) {
      throw new Error(`Invalid keys length: priv=${priv.length}, pub=${pub.length}`);
    }
    
    // Compute shared secret
    const shared = nacl.box.before(pub, priv);
    if (!shared || shared.length !== 32) {
      throw new Error("Shared secret derivation failed");
    }
    
    return shared;
  } catch (e) {
    console.error("ECDH Error:", e);
    // Return a distinguishable "invalid" key rather than zeros
    return new Uint8Array(32).fill(1); 
  }
};

// ─────────────────────────────────────────────
// CIPHER (Salsa20 + Poly1305)
// ─────────────────────────────────────────────
export const encryptText = async (
  message: string,
  sharedSecret: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageUint8 = encoder.encode(message);
  const encrypted = nacl.secretbox(messageUint8, nonce, sharedSecret);
  
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
    const encrypted = decodeBase64(encryptedBase64);
    const nonce = decodeBase64(nonceBase64);
    
    if (encrypted.length === 0 || nonce.length === 0) return null;

    const decrypted = nacl.secretbox.open(encrypted, nonce, sharedSecret);
    
    if (!decrypted) {
      console.warn("[Crypto] Decryption failed (invalid key or corrupted data)");
      return null;
    }
    
    return decoder.decode(decrypted);
  } catch (e) {
    console.error("[Crypto] Decrypt Text Exception:", e);
    return null;
  }
};

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
    const encrypted = decodeBase64(encryptedBase64);
    const nonce = decodeBase64(nonceBase64);
    
    if (encrypted.length === 0 || nonce.length === 0) return null;

    const decrypted = nacl.secretbox.open(encrypted, nonce, sharedSecret);
    return decrypted ? encodeBase64(decrypted) : null;
  } catch (e) {
    console.error("[Crypto] Decrypt File Exception:", e);
    return null;
  }
};
