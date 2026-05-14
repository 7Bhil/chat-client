import nacl from 'tweetnacl';
import * as base64 from 'base64-js';
import CryptoJS from 'crypto-js';

// tweetnacl uses Uint8Array, so we need conversion helpers
const encodeBase64 = (arr: Uint8Array) => base64.fromByteArray(arr);
const decodeBase64 = (str: string) => base64.toByteArray(str);

const stringToUint8 = (str: string) => {
  const words = CryptoJS.enc.Utf8.parse(str);
  const base64Str = CryptoJS.enc.Base64.stringify(words);
  return decodeBase64(base64Str);
};

const uint8ToString = (arr: Uint8Array) => {
  const base64Str = encodeBase64(arr);
  const words = CryptoJS.enc.Base64.parse(base64Str);
  return CryptoJS.enc.Utf8.stringify(words);
};

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Generates a primary identity keypair
 */
export const generateKeyPair = async (): Promise<KeyPair> => {
  const keys = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keys.publicKey),
    privateKey: encodeBase64(keys.secretKey),
  };
};

/**
 * HKDF implementation using CryptoJS for key derivation
 */
const HKDF = (inputKey: Uint8Array, salt: string, info: string): Uint8Array => {
  // Correction : use Base64 parsing to correctly ingest the binary keys
  const ikm = CryptoJS.enc.Base64.parse(encodeBase64(inputKey));
  const saltWa = CryptoJS.enc.Utf8.parse(salt);
  const infoWa = CryptoJS.enc.Utf8.parse(info);
  
  const prk = CryptoJS.HmacSHA256(ikm, saltWa);
  const okm = CryptoJS.HmacSHA256(infoWa, prk);
  
  return decodeBase64(CryptoJS.enc.Base64.stringify(okm));
};

/**
 * Derives a shared secret between two users
 */
export const deriveSharedSecret = (
  myPrivateKey: string,
  theirPublicKey: string
): Uint8Array => {
  const priv = decodeBase64(myPrivateKey);
  const pub = decodeBase64(theirPublicKey);
  
  // Calculate raw DH shared secret
  const shared = nacl.box.before(pub, priv);
  
  // Hash it with SHA-256 to get a final 32-byte symmetric key
  // This is a security best practice for ECDH
  const hash = CryptoJS.SHA256(CryptoJS.enc.Base64.parse(encodeBase64(shared)));
  return decodeBase64(CryptoJS.enc.Base64.stringify(hash));
};

/** 
 * DOUBLE RATCHET IMPLEMENTATION 
 * This ensures that every message has a unique encryption key.
 */

/**
 * Calculates a unique message key using HKDF and a chain secret
 */
export const calculateRatchetKey = (
  chainKey: Uint8Array,
  index: number
): { messageKey: Uint8Array; nextChainKey: Uint8Array } => {
  const info = `ratchet-step-${index}`;
  const nextChainKey = HKDF(chainKey, 'chain-salt', info);
  const messageKey = HKDF(nextChainKey, 'message-salt', info);
  return { messageKey, nextChainKey };
};

/**
 * Advanced Encryption using a derived ratchet key
 */
export const encryptWithRatchet = async (
  message: string,
  messageKey: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageUint8 = stringToUint8(message);
  
  const encrypted = nacl.secretbox(messageUint8, nonce, messageKey);
  
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
};

/**
 * Advanced Decryption using a derived ratchet key
 */
export const decryptWithRatchet = async (
  encryptedBase64: string,
  nonceBase64: string,
  messageKey: Uint8Array
): Promise<string | null> => {
  try {
    const encrypted = decodeBase64(encryptedBase64);
    const nonce = decodeBase64(nonceBase64);
    
    const decrypted = nacl.secretbox.open(encrypted, nonce, messageKey);
    return decrypted ? uint8ToString(decrypted) : null;
  } catch (error) {
    return null;
  }
};

/**
 * Text Encryption using Standard NaCl Box (Asymmetric)
 * This is the most robust method for E2EE as it handles keys internally.
 */
export const encryptText = async (
  message: string,
  theirPublicKey: string,
  myPrivateKey: string
): Promise<{ encrypted: string; nonce: string }> => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(
    stringToUint8(message),
    nonce,
    decodeBase64(theirPublicKey),
    decodeBase64(myPrivateKey)
  );
  return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
};

export const decryptText = async (
  encryptedBase64: string,
  nonceBase64: string,
  theirPublicKey: string,
  myPrivateKey: string
): Promise<string | null> => {
  try {
    const decrypted = nacl.box.open(
      decodeBase64(encryptedBase64),
      decodeBase64(nonceBase64),
      decodeBase64(theirPublicKey),
      decodeBase64(myPrivateKey)
    );
    return decrypted ? uint8ToString(decrypted) : null;
  } catch (error) {
    console.error("Critical Decryption Error:", error);
    return null;
  }
};

/**
 * Standard Box Encryption (Legacy single-string payload)
 */
/*
 * Binary Encryption for Files/Images
 */
export const encryptFile = async (
  base64Data: string,
  messageKey: Uint8Array
): Promise<{ encrypted: string; nonce: string }> => {
  const binary = decodeBase64(base64Data);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  
  const encrypted = nacl.secretbox(binary, nonce, messageKey);
  
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
};

/**
 * Binary Decryption for Files/Images
 */
export const decryptFile = async (
  encryptedBase64: string,
  nonceBase64: string,
  messageKey: Uint8Array
): Promise<string | null> => {
  try {
    const encrypted = decodeBase64(encryptedBase64);
    const nonce = decodeBase64(nonceBase64);
    
    const decrypted = nacl.secretbox.open(encrypted, nonce, messageKey);
    return decrypted ? encodeBase64(decrypted) : null;
  } catch (error) {
    return null;
  }
};
