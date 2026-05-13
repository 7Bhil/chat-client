import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { Shield, MessageSquare, LogOut, ChevronRight, Circle, Lock } from 'lucide-react-native';
import { useAuth } from '../../utils/AuthContext';
import { supabase } from '../../utils/supabase';
import * as LocalAuthentication from 'expo-local-authentication';

export default function ChatListScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const { session, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const router = useRouter();

  const fetchUsers = async () => {
    if (!session?.user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', session.user.id); // Ne pas s'afficher soi-même

      if (error) throw error;
      setUsers(data || []);

      // Fetch current user's profile to get username
      const { data: myProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .single();
      
      if (myProfile) setUsername(myProfile.username);

    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();

    if (!session?.user) return;

    // Presence Channel
    const channel = supabase.channel('online-users', {
      config: { presence: { key: session.user.id } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const onlineIds = Object.keys(state);
        setUsers(prev => prev.map(u => ({
          ...u,
          isOnline: onlineIds.includes(u.id)
        })));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => { channel.unsubscribe(); };
  }, [session]);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const openChat = async (item: any) => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (hasHardware) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Unlock chat with ${item.username}`,
        fallbackLabel: 'Enter Passcode'
      });
      if (!result.success) return;
    }

    router.push({
      pathname: '/chat/[id]',
      params: { id: item.id, username: item.username, publicKey: item.public_key }
    });
  };

  const renderUser = ({ item }: { item: any }) => (
    <TouchableOpacity 
      style={styles.userCard}
      onPress={() => openChat(item)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.username[0].toUpperCase()}</Text>
        {item.isOnline && <View style={styles.onlineIndicator} />}
      </View>
      <View style={styles.userInfo}>
        <View style={styles.usernameRow}>
          <Text style={styles.username}>{item.username}</Text>
          <Lock size={12} color={Theme.colors.textSecondary} style={{marginLeft: 4, opacity: 0.5}} />
        </View>
        <Text style={styles.userStatus}>{item.isOnline ? 'Online now' : 'Tap to start secure chat'}</Text>
      </View>
      <ChevronRight size={20} color={Theme.colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.brand}>
            <Shield size={24} color={Theme.colors.primary} />
            <Text style={styles.headerTitle}>Messages</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <LogOut size={20} color={Theme.colors.error} />
          </TouchableOpacity>
        </View>
        <Text style={styles.welcomeText}>Welcome, {username || 'Secure User'}</Text>
      </View>

      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={renderUser}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchUsers} tintColor={Theme.colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MessageSquare size={48} color={Theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No users found yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.md,
    backgroundColor: Theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.sm,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Theme.colors.text,
  },
  welcomeText: {
    fontSize: 14,
    color: Theme.colors.textSecondary,
  },
  logoutBtn: {
    padding: Theme.spacing.sm,
  },
  listContent: {
    padding: Theme.spacing.md,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.sm,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Theme.colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Theme.spacing.md,
  },
  avatarText: {
    color: Theme.colors.text,
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '700',
    color: Theme.colors.text,
  },
  userStatus: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4ade80',
    borderWidth: 2,
    borderColor: Theme.colors.surface,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyText: {
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.md,
    fontSize: 16,
  },
});

