import nacl from 'tweetnacl';
import * as base64 from 'base64-js';

// tweetnacl uses Uint8Array, so we need conversion helpers
const encodeBase64 = (arr: Uint8Array) => base64.fromByteArray(arr);
const decodeBase64 = (str: string) => base64.toByteArray(str);
const stringToUint8 = (str: string) => new TextEncoder().encode(str);
const uint8ToString = (arr: Uint8Array) => new TextDecoder().decode(arr);

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
  
  // Combine nonce and encrypted message
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  
  return encodeBase64(combined);
};

export const decryptMessage = async (
  encryptedMessageBase64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Promise<string | null> => {
  try {
    const combined = decodeBase64(encryptedMessageBase64);
    const pubKey = decodeBase64(senderPublicKey);
    const privKey = decodeBase64(recipientPrivateKey);
    
    if (combined.length < nacl.box.nonceLength) {
      return null;
    }
    
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const encrypted = combined.slice(nacl.box.nonceLength);
    
    const decrypted = nacl.box.open(encrypted, nonce, pubKey, privKey);
    return decrypted ? uint8ToString(decrypted) : null;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
};
