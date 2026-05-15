import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Theme } from '../constants/theme';
import { SecureButton } from '../components/SecureButton';
import { LoadingScreen } from '../components/LoadingScreen';
import { generateKeyPair } from '../utils/encryption';
import { storePrivateKey } from '../utils/api';
import { useAuth } from '../utils/AuthContext';
import { supabase } from '../utils/supabase';
import * as SecureStore from 'expo-secure-store';
import { Lock, User, Key, Fingerprint } from 'lucide-react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export default function SignupScreen() {
  const {  } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [usePasscode, setUsePasscode] = useState(false);
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      setHasBiometrics(compatible && types.length > 0);
    })();
  }, []);

  const handleSignup = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }

    if (usePasscode && passcode.length < 4) {
      Alert.alert('Error', 'Passcode must be at least 4 digits');
      return;
    }

    setLoading(true);
    try {
      if (useBiometrics) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enroll Biometrics',
          fallbackLabel: 'Use Password',
        });
        if (!result.success) {
          setLoading(false);
          return;
        }
      }

      // 1. Generate E2EE keys LOCALLY
      const keys = await generateKeyPair();
      
      // 2. Store security preferences

      if (usePasscode) {
        await SecureStore.setItemAsync('app_passcode', passcode);
        await SecureStore.setItemAsync('usePasscode', 'true');
      }

      if (useBiometrics) {
        await SecureStore.setItemAsync('useBiometrics', 'true');
      }

      // 4. Supabase Signup
      // Create a virtual email for Supabase Auth
      const cleanUsername = username.trim().toLowerCase();
      const virtualEmail = `${cleanUsername}@chat.app`;
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: virtualEmail,
        password: password,
      });

      if (authError) throw authError;

      if (authData.user) {
        // 5. Create Public Profile
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            username: username.trim(), // Keep original display casing for profile
            public_key: keys.publicKey,
          });

        if (profileError) throw profileError;

        // 6. Store Private Key SECURELY on device mapped to the user ID
        await storePrivateKey(authData.user.id, keys.privateKey);
      }

      Alert.alert('Success', 'Account created successfully!');
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', error.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };


  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      {loading && <LoadingScreen overlay speed={80} />}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Lock size={40} color={Theme.colors.primary} />
          </View>
          <Text style={styles.title}>SecureChat</Text>
          <Text style={styles.subtitle}>End-to-End Encrypted Messaging</Text>
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

          {hasBiometrics && (
            <View style={styles.biometricRow}>
              <View style={styles.biometricLabel}>
                <Fingerprint size={20} color={Theme.colors.primary} />
                <Text style={styles.biometricText}>Enable Biometric Login</Text>
              </View>
              <Switch
                value={useBiometrics}
                onValueChange={setUseBiometrics}
                trackColor={{ false: '#334155', true: Theme.colors.primary }}
                thumbColor={useBiometrics ? '#fff' : '#94a3b8'}
              />
            </View>
          )}

          <View style={styles.biometricRow}>
            <View style={styles.biometricLabel}>
              <Lock size={20} color={Theme.colors.primary} />
              <Text style={styles.biometricText}>App Passcode (PIN)</Text>
            </View>
            <Switch
              value={usePasscode}
              onValueChange={setUsePasscode}
              trackColor={{ false: '#334155', true: Theme.colors.primary }}
              thumbColor={usePasscode ? '#fff' : '#94a3b8'}
            />
          </View>

          {usePasscode && (
            <View style={styles.inputContainer}>
              <Key size={20} color={Theme.colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter 4-6 digit PIN"
                placeholderTextColor={Theme.colors.textSecondary}
                value={passcode}
                onChangeText={setPasscode}
                keyboardType="numeric"
                secureTextEntry
                maxLength={6}
              />
            </View>
          )}

          <View style={styles.infoBox}>
            <Key size={16} color={Theme.colors.primary} />
            <Text style={styles.infoText}>
              Your encryption keys will be generated locally and never leave your device.
            </Text>
          </View>

          <SecureButton 
            title="Create Secure Account" 
            onPress={handleSignup} 
            loading={loading} 
          />

          <TouchableOpacity onPress={() => router.push('/login')} style={styles.link}>
            <Text style={styles.linkText}>Already have an account? Log in</Text>
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
  biometricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  biometricLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  biometricText: {
    color: Theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.md,
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  infoText: {
    color: Theme.colors.textSecondary,
    fontSize: 12,
    flex: 1,
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
});
