import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mooctqjvxiqkxzdmshos.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vb2N0cWp2eGlxa3h6ZG1zaG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjI2MDgsImV4cCI6MjA5NDIzODYwOH0.SCgVKhsVBaYOjGYoHekHEj82iypa4lCQ6YHR7nhS3BM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

