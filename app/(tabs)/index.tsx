import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Theme } from '../../constants/theme';
import { Shield, MessageSquare, LogOut, ChevronRight, Circle, Lock } from 'lucide-react-native';
import { useAuth } from '../../utils/AuthContext';
import { supabase } from '../../utils/supabase';
import { LoadingScreen } from '../../components/LoadingScreen';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function ChatListScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const { session, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const router = useRouter();
  const channelRef = useRef<any>(null);

  const fetchUsers = async () => {
    if (!session?.user) return;
    
    setLoading(true);
    try {
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', session.user.id);

      if (error) throw error;

      // Récupère l'historique des messages pour déterminer le tri et les non-lus
      const { data: messages } = await supabase
        .from('messages')
        .select('sender_id, receiver_id, created_at, is_read')
        .or(`sender_id.eq.${session.user.id},receiver_id.eq.${session.user.id}`);

      const processedProfiles = await Promise.all((profiles || []).map(async profile => {
        const chatMessages = messages?.filter(m => m.sender_id === profile.id || m.receiver_id === profile.id) || [];
        const latestMsg = chatMessages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        
        const lastReadStr = await AsyncStorage.getItem(`last_read_${session.user.id}_${profile.id}`);
        const lastReadTime = lastReadStr ? parseInt(lastReadStr, 10) : 0;
        
        // Count messages sent by them strictly AFTER our last local read time
        const unreadCount = chatMessages.filter(m => m.sender_id === profile.id && new Date(m.created_at).getTime() > lastReadTime).length;

        return {
          ...profile,
          latestInteraction: latestMsg ? new Date(latestMsg.created_at).getTime() : 0,
          unreadCount
        };
      }));

      setUsers(processedProfiles.sort((a, b) => b.latestInteraction - a.latestInteraction));

      const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', session.user.id).single();
      if (myProfile) setUsername(myProfile.username);

    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      // Small delay to ensure DB updates from chat screen are persisted
      const timer = setTimeout(() => {
        fetchUsers();
      }, 150);
      return () => clearTimeout(timer);
    }, [session?.user?.id])
  );

  useEffect(() => {
    // Initial fetch handled by focus effect

    if (!session?.user?.id) return;
    const channelId = 'online-users';

    // 1. Cherche si le canal existe déjà (créé par un montage précédent)
    let channel = supabase.getChannels().find(c => c.topic === channelId);

    // 2. Si le canal n'existe pas, on le crée
    if (!channel) {
      channel = supabase.channel(channelId, {
        config: { presence: { key: session.user.id } }
      });
    }

    // 3. SEULEMENT s'il est 'closed' (pas encore abonné), on lance l'abonnement
    // C'est ce qui évite l'erreur "cannot add presence callbacks after subscribe"
    if (channel.state === 'closed') {
      channel
        .on('presence', { event: 'sync' }, () => {
          if (!channelRef.current) return;
          const state = channelRef.current.presenceState();
          const onlineIds = Object.keys(state);
          setUsers(prev => prev.map(u => ({
            ...u,
            isOnline: onlineIds.includes(u.id)
          })));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && channelRef.current) {
            await channelRef.current.track({ online_at: new Date().toISOString() });
          }
        });
    }

    // 4. On stocke la référence du canal
    channelRef.current = channel;

    // 5. Écoute globale des nouveaux messages pour incrémenter les "non lus"
    // et faire remonter immédiatement le profil en haut de la liste
    const syncUnreadCount = async (senderId: string) => {
      const lastReadStr = await AsyncStorage.getItem(`last_read_${session.user.id}_${senderId}`);
      const lastReadTime = lastReadStr ? parseInt(lastReadStr, 10) : 0;
      
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('sender_id', senderId)
        .eq('receiver_id', session.user.id)
        .gt('created_at', new Date(lastReadTime).toISOString());
      
      setUsers(prev => prev.map(u => u.id === senderId ? { ...u, unreadCount: count || 0, latestInteraction: new Date().getTime() } : u).sort((a, b) => b.latestInteraction - a.latestInteraction));
    };

    const globalMessagesChannel = supabase.channel('global-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, (payload) => {
          syncUnreadCount(payload.new.sender_id);
      })
      .subscribe();

    return () => {
        supabase.removeChannel(globalMessagesChannel);
    };
  }, [session?.user?.id]);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

    const openChat = async (item: any) => {
      // Efface immédiatement la pastille des non-lus en local et sauvegarde l'heure
      await AsyncStorage.setItem(`last_read_${session?.user?.id}_${item.id}`, new Date().getTime().toString());
      setUsers(prev => prev.map(u => u.id === item.id ? { ...u, unreadCount: 0 } : u));

      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: `Unlock ${item.username}`,
          fallbackLabel: 'Use PIN/Passcode',
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });

        if (!result.success) {
          // Si l'utilisateur annule, on ne fait rien (on reste sur la liste)
          return;
        }
      }

      // Si pas de biométrie configureé ou succès authentification
      router.push({
        pathname: '/chat/[id]',
        params: { id: item.id, username: item.username, publicKey: item.public_key }
      });
    } catch (err) {
      console.error('Bio-Lock error:', err);
      // En cas d'erreur technique, on permet quand même l'accès ou on affiche une alerte
      Alert.alert('Error', 'Security check failed. Please try again.');
    }
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
          <Text style={[styles.username, item.unreadCount > 0 && styles.usernameUnread]}>{item.username}</Text>
          <Lock size={12} color={Theme.colors.textSecondary} style={{marginLeft: 4, opacity: 0.5}} />
        </View>
        <Text style={[styles.userStatus, item.unreadCount > 0 && styles.statusUnread]}>
          {item.unreadCount > 0 
            ? 'New encrypted message' 
            : (item.isOnline ? 'Online now' : 'Tap to start secure chat')}
        </Text>
      </View>
      
      {item.unreadCount > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
        </View>
      ) : (
        <ChevronRight size={20} color={Theme.colors.textSecondary} />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {(loading && users.length === 0) && <LoadingScreen speed={100} />}
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
  usernameUnread: {
    color: '#fff',
    fontWeight: '900',
  },
  statusUnread: {
    color: Theme.colors.primary,
    fontWeight: '700',
  },
  unreadBadge: {
    backgroundColor: Theme.colors.primary,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: Theme.colors.background,
    fontSize: 12,
    fontWeight: 'bold',
  }
});

