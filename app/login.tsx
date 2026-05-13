import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Theme } from '../constants/theme';
import { SecureButton } from '../components/SecureButton';
import { api, storeUser } from '../utils/api';
import { useAuth } from '../utils/AuthContext';
import * as SecureStore from 'expo-secure-store';
import { Lock, User, Fingerprint } from 'lucide-react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export default function LoginScreen() {
  const { login: authLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const router = useRouter();

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const prefEnabled = await SecureStore.getItemAsync('useBiometrics') === 'true';
    const savedToken = await SecureStore.getItemAsync('token');
    
    setCanUseBiometrics(hasBiometrics && isEnrolled && prefEnabled && !!savedToken);
    
    if (hasBiometrics && isEnrolled && prefEnabled && !!savedToken) {
        handleBiometricAuth();
    }
  };

  const handleBiometricAuth = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Login with Biometrics',
      fallbackLabel: 'Use Password',
    });

    if (result.success) {
      router.replace('/(tabs)');
    }
  };

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/login', {
        username,
        password
      });
      
      const { token, user } = response.data;
      await authLogin(token, user);
      
      // Check if private key exists
      const privKey = await SecureStore.getItemAsync('privateKey');
      if (!privKey) {
          Alert.alert('Warning', 'Private key not found on this device. You will not be able to decrypt old messages.');
      }
      
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      const errorMessage = error.response?.status === 401 
        ? 'Invalid username or password' 
        : (error.response?.data?.error || 'Login failed');
      Alert.alert('Error', errorMessage);
    } finally {

      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Lock size={40} color={Theme.colors.primary} />
          </View>
          <Text style={styles.title}>SecureChat</Text>
          <Text style={styles.subtitle}>Welcome back, secure your connection</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <User size={20} color={Theme.colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={Theme.colors.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Lock size={20} color={Theme.colors.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Theme.colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <SecureButton 
            title="Secure Login" 
            onPress={handleLogin} 
            loading={loading} 
          />

          {canUseBiometrics && (
            <TouchableOpacity onPress={handleBiometricAuth} style={styles.biometricBtn}>
              <Fingerprint size={32} color={Theme.colors.primary} />
              <Text style={styles.biometricBtnText}>Login with Biometrics</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={() => router.push('/signup')} style={styles.link}>
            <Text style={styles.linkText}>Don't have an account? Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Theme.spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Theme.spacing.xl * 2,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Theme.colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  form: {
    gap: Theme.spacing.md,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingHorizontal: Theme.spacing.md,
    height: 56,
  },
  inputIcon: {
    marginRight: Theme.spacing.sm,
  },
  input: {
    flex: 1,
    color: Theme.colors.text,
    fontSize: 16,
  },
  link: {
    marginTop: Theme.spacing.md,
    alignItems: 'center',
  },
  linkText: {
    color: Theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.md,
    marginTop: Theme.spacing.lg,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.surface,
  },
  biometricBtnText: {
    color: Theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
