import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Theme } from '../constants/theme';
import { SecureButton } from '../components/SecureButton';
import { useAuth } from '../utils/AuthContext';
import { supabase } from '../utils/supabase';
import { getPrivateKey, storePrivateKey } from '../utils/api';
import { generateKeyPair, deriveSharedSecret, encodeBase64, decodeBase64 } from '../utils/encryption';
import * as SecureStore from 'expo-secure-store';
import { Lock, User, Fingerprint } from 'lucide-react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Key, X, Fingerprint as FingerprintIcon } from 'lucide-react-native';
import { Modal } from 'react-native';
import { LoadingScreen } from '../components/LoadingScreen';
import nacl from 'tweetnacl';


export default function LoginScreen() {
  const {  } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [showPasscodeLock, setShowPasscodeLock] = useState(false);
  const [enteredPasscode, setEnteredPasscode] = useState('');
  const [storedPasscode, setStoredPasscode] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    checkSecurityPrefs();
  }, []);

  const checkSecurityPrefs = async () => {
    const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const useBioPref = await SecureStore.getItemAsync('useBiometrics') === 'true';
    const usePassPref = await SecureStore.getItemAsync('usePasscode') === 'true';
    const savedPass = await SecureStore.getItemAsync('app_passcode');

    setCanUseBiometrics(hasBiometrics && isEnrolled && useBioPref);
    setStoredPasscode(savedPass);

    if (usePassPref && savedPass) {
      setShowPasscodeLock(true);
      // Auto-trigger biometrics if enabled
      if (hasBiometrics && isEnrolled && useBioPref) {
        handleBiometricPasscodeUnlock();
      }
    }
  };

  const handleBiometricPasscodeUnlock = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Anonyme',
    });
    if (result.success) {
      setShowPasscodeLock(false);
    }
  };

  const checkPasscode = () => {
    if (enteredPasscode === storedPasscode) {
      setShowPasscodeLock(false);
    } else if (enteredPasscode.length >= (storedPasscode?.length || 4)) {
      Alert.alert('Error', 'Incorrect Passcode');
      setEnteredPasscode('');
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
      const cleanUsername = username.trim().toLowerCase();
      const virtualEmail = `${cleanUsername}@chat.app`;
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: virtualEmail,
        password: password,
      });

      if (authError) throw authError;

      // ── KEY INTEGRITY CHECK ──────────────────────────────────────────
      // 1. Fetch the public key currently stored in DB for this user
      const { data: profile } = await supabase
        .from('profiles')
        .select('public_key')
        .eq('id', authData.user.id)
        .single();

      // 2. Get private key from this device's SecureStore
      const privKey = await getPrivateKey(authData.user.id);

      if (!privKey || !profile?.public_key) {
        // No local key found: this is a new device install
        console.warn('[Crypto] No local private key — generating fresh keypair for this device');
        const keys = await generateKeyPair();
        await storePrivateKey(authData.user.id, keys.privateKey);
        await supabase
          .from('profiles')
          .update({ public_key: keys.publicKey })
          .eq('id', authData.user.id);
        Alert.alert(
          '⚠️ Notice de Sécurité',
          'Appareil/installation non reconnu(e). De nouvelles clés de chiffrement ont été créées.\n\nVos anciens messages chiffrés sont inaccessibles sur cet appareil, mais les nouveaux messages fonctionneront normalement.',
          [{ text: 'Compris', style: 'default' }]
        );
      } else {
        // 3. ══ IMPORTANT ══ Verify that local private key matches DB public key
        //    Derive the public key from the stored private key and compare
        try {
          const privBytes = decodeBase64(privKey.trim());
          if (privBytes.length === 32) {
            const derivedKeyPair = nacl.box.keyPair.fromSecretKey(privBytes);
            const derivedPubKey = encodeBase64(derivedKeyPair.publicKey);
            const dbPubKey = profile.public_key.trim();

            if (derivedPubKey !== dbPubKey) {
              // ⚠️ Mismatch: local private key doesn't match DB public key
              // This means someone logged in from another device previously and regenerated keys
              console.error('[Crypto] KEY MISMATCH detected!');
              console.error('  Derived from local privKey:', derivedPubKey.substring(0, 16));
              console.error('  DB public key:             ', dbPubKey.substring(0, 16));

              // Fix: re-publish the correct public key to DB so future contacts can encrypt to us
              await supabase
                .from('profiles')
                .update({ public_key: derivedPubKey })
                .eq('id', authData.user.id);

              Alert.alert(
                '🔑 Clés resynchronisées',
                'Votre clé publique en base de données ne correspondait pas à votre clé locale.\n\nElle a été automatiquement corrigée. Les nouveaux messages seront chiffrés correctement.',
                [{ text: 'OK' }]
              );
            } else {
              console.log('[Crypto] ✅ Key integrity check passed — keys are in sync');
            }
          }
        } catch (keyCheckErr) {
          console.error('[Crypto] Key integrity check failed:', keyCheckErr);
        }
      }
      // ── END KEY INTEGRITY CHECK ──────────────────────────────────────

      router.replace('/(tabs)');
    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', error.message || 'Login failed');
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
            <Text style={styles.linkText}>Don&apos;t have an account? Sign up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Internal Passcode Lock Modal */}
      <Modal visible={showPasscodeLock} animationType="slide" transparent={false}>
        <View style={styles.lockContainer}>
          <View style={styles.lockHeader}>
            <Lock size={64} color={Theme.colors.primary} />
            <Text style={styles.lockTitle}>Anonyme Locked</Text>
            <Text style={styles.lockSubtitle}>Enter your secret code to continue</Text>
          </View>

          <View style={styles.pinDisplay}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              i <= (storedPasscode?.length || 4) ? (
                <View key={i} style={[styles.pinDot, enteredPasscode.length >= i && styles.pinDotActive]} />
              ) : null
            ))}
          </View>

          <View style={styles.numpad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'bio', 0, 'del'].map((val, idx) => (
              <TouchableOpacity 
                key={idx} 
                style={styles.numBtn}
                onPress={() => {
                  if (val === 'del') setEnteredPasscode(prev => prev.slice(0, -1));
                  else if (val === 'bio') handleBiometricPasscodeUnlock();
                  else if (typeof val === 'number') setEnteredPasscode(prev => prev + val);
                }}
              >
                {val === 'del' ? <X size={24} color={Theme.colors.text} /> :
                 val === 'bio' ? <FingerprintIcon size={24} color={canUseBiometrics ? Theme.colors.primary : 'transparent'} /> :
                 <Text style={styles.numBtnText}>{val}</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <View style={{marginTop: 40, width: '100%'}}>
            <SecureButton 
              title="Unlock" 
              onPress={checkPasscode} 
              loading={false}
            />
          </View>
        </View>
      </Modal>
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
  lockContainer: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    padding: Theme.spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockHeader: {
    alignItems: 'center',
    marginBottom: 60,
  },
  lockTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Theme.colors.text,
    marginTop: 20,
  },
  lockSubtitle: {
    fontSize: 16,
    color: Theme.colors.textSecondary,
    marginTop: 10,
  },
  pinDisplay: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 60,
  },
  pinDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Theme.colors.border,
  },
  pinDotActive: {
    backgroundColor: Theme.colors.primary,
    borderColor: Theme.colors.primary,
  },
  numpad: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
  },
  numBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  numBtnText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Theme.colors.text,
  },
});
