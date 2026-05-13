import nacl from 'tweetnacl';
import * as base64 from 'base64-js';
import CryptoJS from 'crypto-js';

// tweetnacl uses Uint8Array, so we need conversion helpers
const encodeBase64 = (arr: Uint8Array) => base64.fromByteArray(arr);
const decodeBase64 = (str: string) => base64.toByteArray(str);
const stringToUint8 = (str: string) => new TextEncoder().encode(str);
const uint8ToString = (arr: Uint8Array) => new TextDecoder().decode(arr);

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
  const ikm = CryptoJS.enc.Hex.parse(encodeBase64(inputKey));
  const saltWa = CryptoJS.enc.Utf8.parse(salt);
  const infoWa = CryptoJS.enc.Utf8.parse(info);
  
  // Simple HMAC-based derivation
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
  return nacl.box.before(pub, priv);
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
 * Standard Box Encryption (Initial handshake / Legacy)
 */
export const encryptMessage = async (
  message: string,
  recipientPublicKey: string,
  senderPrivateKey: string
): Promise<string> => {
  const pubKey = decodeBase64(recipientPublicKey);
  const privKey = decodeBase64(senderPrivateKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = stringToUint8(message);
  
  const encrypted = nacl.box(messageUint8, nonce, pubKey, privKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  
  return encodeBase64(combined);
};

/**
 * Standard Box Decryption
 */
export const decryptMessage = async (
  encryptedMessageBase64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Promise<string | null> => {
  try {
    const combined = decodeBase64(encryptedMessageBase64);
    const pubKey = decodeBase64(senderPublicKey);
    const privKey = decodeBase64(recipientPrivateKey);
    
    if (combined.length < nacl.box.nonceLength) return null;
    
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const encrypted = combined.slice(nacl.box.nonceLength);
    
    const decrypted = nacl.box.open(encrypted, nonce, pubKey, privKey);
    return decrypted ? uint8ToString(decrypted) : null;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};
/**
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
