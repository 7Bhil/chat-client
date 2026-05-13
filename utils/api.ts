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

export const storePrivateKey = async (privateKey: string) => {
  await SecureStore.setItemAsync('privateKey', privateKey);
};

export const getPrivateKey = async () => {
  return await SecureStore.getItemAsync('privateKey');
};

export const storeUser = async (user: any) => {
  await SecureStore.setItemAsync('user', JSON.stringify(user));
};

export const getUser = async () => {
  const user = await SecureStore.getItemAsync('user');
  return user ? JSON.parse(user) : null;
};
