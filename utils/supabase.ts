import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mooctqjvxiqkxzdmshos.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vb2N0cWp2eGlxa3h6ZG1zaG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjI2MDgsImV4cCI6MjA5NDIzODYwOH0.SCgVKhsVBaYOjGYoHekHEj82iypa4lCQ6YHR7nhS3BM';

// Custom storage adapter for Supabase using Expo SecureStore
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

