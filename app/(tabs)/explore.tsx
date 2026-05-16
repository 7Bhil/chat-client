import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Clipboard } from 'react-native';
import { useAuth } from '../../utils/AuthContext';
import { supabase } from '../../utils/supabase';
import { Theme } from '../../constants/theme';
import { LogOut, Copy, User, ShieldCheck, Key } from 'lucide-react-native';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const { session, logout } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfile();
    }
  }, [session?.user?.id]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session?.user?.id)
        .single();
        
      if (error) throw error;
      setProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const copyToClipboard = (text: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied', 'Public key copied to clipboard.');
  };

  if (!profile) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.loadingText}>Loading Profile...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <User size={48} color={Theme.colors.background} />
        </View>
        <Text style={styles.username}>{profile.username || 'Utilisateur'}</Text>
        <View style={styles.badgeContainer}>
          <ShieldCheck size={16} color={Theme.colors.primary} />
          <Text style={styles.badgeText}>Sécurisé E2EE</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security Settings</Text>
        
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Key size={20} color={Theme.colors.primary} />
            <Text style={styles.cardTitle}>My Public Key</Text>
          </View>
          <Text style={styles.cardDescription}>
            This is your cryptographic identity. Others use this to encrypt messages sent to you.
          </Text>
          
          <View style={styles.keyBox}>
            <Text style={styles.keyText} numberOfLines={2} ellipsizeMode="middle">
              {profile.public_key}
            </Text>
            <TouchableOpacity onPress={() => copyToClipboard(profile.public_key)} style={styles.copyBtn}>
              <Copy size={20} color={Theme.colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.logoutSection}>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut size={20} color={Theme.colors.background} />
          <Text style={styles.logoutButtonText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  loadingText: {
    color: Theme.colors.textSecondary,
    fontSize: 16,
  },
  header: {
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 40,
    backgroundColor: Theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Theme.colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },
  username: {
    color: Theme.colors.text,
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: Theme.spacing.xs,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.primary + '20',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
    borderRadius: 20,
    gap: 6,
  },
  badgeText: {
    color: Theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    padding: Theme.spacing.lg,
  },
  sectionTitle: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: Theme.spacing.md,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: Theme.colors.surface,
    borderRadius: Theme.borderRadius.lg,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  cardTitle: {
    color: Theme.colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  cardDescription: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    marginBottom: Theme.spacing.md,
    lineHeight: 20,
  },
  keyBox: {
    backgroundColor: Theme.colors.background,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  keyText: {
    color: Theme.colors.text,
    fontFamily: 'monospace',
    flex: 1,
    marginRight: Theme.spacing.md,
  },
  copyBtn: {
    padding: Theme.spacing.sm,
  },
  logoutSection: {
    padding: Theme.spacing.lg,
    marginTop: 20,
  },
  logoutButton: {
    backgroundColor: Theme.colors.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    gap: Theme.spacing.sm,
  },
  logoutButtonText: {
    color: Theme.colors.background,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
