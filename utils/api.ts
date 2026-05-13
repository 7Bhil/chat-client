import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = 'http://10.81.95.51:5000'; // Updated to your machine IP

export const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Note: SecureStore has a 2048 byte limit on Android. 
// Our private keys are small (TweetNaCl keys are 32 bytes binary -> ~44 chars base64),
// so the warning might come from storing large JSON objects (like the whole user profile).

export const storePrivateKey = async (privateKey: string) => {
  try {
    await SecureStore.setItemAsync('privateKey', privateKey);
    console.log('Private key stored successfully');
  } catch (err) {
    console.error('Failed to store private key:', err);
  }
};

export const getPrivateKey = async () => {
  return await SecureStore.getItemAsync('privateKey');
};

export const storeUser = async (user: any) => {
    // We only store the essential parts to avoid the 2048 bytes limit
    const minimalUser = { id: user.id, username: user.username };
    await SecureStore.setItemAsync('user', JSON.stringify(minimalUser));
};

export const getUser = async () => {
  const user = await SecureStore.getItemAsync('user');
  return user ? JSON.parse(user) : null;
};
