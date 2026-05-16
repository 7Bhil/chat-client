import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../utils/AuthContext';
import { encryptText, decryptText, deriveSharedSecret, encryptFile, decryptFile } from '../../utils/encryption';
import { getPrivateKey } from '../../utils/api';
import { Send, Camera, Image as ImageIcon, Clock, X, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenCapture from 'expo-screen-capture';
import { LoadingScreen } from '../../components/LoadingScreen';

const EXPIRY_OPTIONS = [
  { label: 'Off', seconds: null },
  { label: '5s', seconds: 5 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
];

const LOCKED_TEXT = '[🔒 Clés désynchronisées]';

export default function ChatDetailScreen() {
  const { id, username, publicKey: initialPublicKey } = useLocalSearchParams();
  const { session } = useAuth();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  // The shared secret is computed once and stored in a ref for the whole session
  const sharedSecretRef = useRef<Uint8Array | null>(null);
  // Track the active Supabase channel to avoid duplicate subscriptions
  const channelRef = useRef<any>(null);
  // Guard against concurrent initChat calls (React StrictMode / re-renders)
  const isInitiatingRef = useRef(false);

  useEffect(() => {
    // Empêcher les captures d'écran sur cet écran confidentiel
    ScreenCapture.preventScreenCaptureAsync().catch(console.warn);

    if (session?.user && id) {
      initChat();
    }
    // Cleanup: allow screenshots back when leaving, and unsubscribe
    return () => {
      ScreenCapture.allowScreenCaptureAsync().catch(console.warn);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [session?.user?.id, id]);

  const initChat = async () => {
    if (!session?.user) return;
    // Prevent concurrent calls (React StrictMode double-invocation)
    if (isInitiatingRef.current) return;
    isInitiatingRef.current = true;

    setIsInitializing(true);
    try {
      // 1. Always fetch fresh public key from DB
      const { data: profile } = await supabase
        .from('profiles')
        .select('public_key')
        .eq('id', id)
        .single();

      if (!profile?.public_key) {
        Alert.alert('Error', 'Could not load contact keys.');
        return;
      }
      const theirPubKey = profile.public_key.trim();

      // 2. Get MY private key — strictly tied to my user ID
      const myPrivKey = await getPrivateKey(session.user.id);
      if (!myPrivKey) {
        Alert.alert('Error', 'Your encryption key is missing. Please log out and log back in.');
        return;
      }

      // 3. Compute shared secret ONCE and keep it in a ref
      sharedSecretRef.current = deriveSharedSecret(myPrivKey.trim(), theirPubKey);
      const secretFingerprint = Array.from(sharedSecretRef.current.slice(0, 8)).join(',');
      console.log(`[Crypto] initChat — Shared Secret Fingerprint: [${secretFingerprint}]`);

      // 4. Fetch message history
      await fetchHistory(sharedSecretRef.current, session.user.id);

      // 5. Subscribe to new messages (unsubscribe first if already subscribed)
      subscribeToMessages(sharedSecretRef.current, session.user.id);

      // 6. Try to delete fetched messages in fetchHistory, but mark them as read here as a reliable fallback
      await supabase.from('messages')
        .update({ is_read: true })
        .eq('receiver_id', session.user.id)
        .eq('sender_id', id);

    } catch (err) {
      console.error('initChat error:', err);
    } finally {
      setIsInitializing(false);
      isInitiatingRef.current = false;
    }
  };

  const fetchHistory = async (secret: Uint8Array, myUserId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${myUserId},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${myUserId})`)
      .order('created_at', { ascending: true });

    if (error || !data) return;

    // Debug: log the shared secret fingerprint to verify both sides compute the same one
    const secretFingerprint = Array.from(secret.slice(0, 8)).join(',');
    console.log(`[Crypto] fetchHistory — Secret Fingerprint: [${secretFingerprint}]`);
    console.log(`[Crypto] Attempting to decrypt ${data.length} messages...`);

    const decoded = await Promise.all(data.map(async (msg) => {
      try {
        const baseType = msg.type?.split(':')[0] || 'text';
        const expiryStr = msg.type?.split(':')[1];
        const expirySeconds = expiryStr ? parseInt(expiryStr, 10) : null;
        
        let localExpiresAt = msg.expires_at;

        // If it's an ephemeral message without a hard server expiry date limit, calculate it locally
        if (!localExpiresAt && expirySeconds) {
            if (msg.sender_id === myUserId) {
                // If I am the sender recovering history, timer started when I sent it
                localExpiresAt = new Date(new Date(msg.created_at).getTime() + expirySeconds * 1000).toISOString();
            } else {
                // If I am the receiver, timer starts EXACTLY NOW because I just read it!
                localExpiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
            }
        }

        // Drop if it has already expired
        if (localExpiresAt && new Date(localExpiresAt).getTime() < Date.now()) return null;

        const isImage = baseType === 'image' || baseType === 'image-once';
        
        const content = isImage
          ? await decryptFile(msg.encrypted_content, msg.nonce, secret)
          : await decryptText(msg.encrypted_content, msg.nonce, secret);

        if (!content) {
          console.warn(`[Crypto] ❌ Decryption FAILED for message ${msg.id}. Sent by: ${msg.sender_id === myUserId ? 'Me' : 'Them'}`);
          return null;
        }

        return {
          id: msg.id,
          text: content,
          type: msg.type,
          sender: msg.sender_id === myUserId ? 'me' : 'other',
          timestamp: msg.created_at,
          expiresAt: localExpiresAt,
        };
      } catch (e) {
        console.error('[Crypto] Exception decrypt msg', msg.id, e);
        return null;
      }
    }));

    const validRemote = decoded.filter(Boolean) as any[];

    // Read local messages
    const localData = await AsyncStorage.getItem(`chat_${myUserId}_${id}`);
    const localMessages = localData ? JSON.parse(localData) : [];

    // Merge and deduplicate
    const allMessagesMap = new Map();
    [...localMessages, ...validRemote].forEach(m => allMessagesMap.set(m.id, m));
    const mergedMessages = Array.from(allMessagesMap.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    setMessages(mergedMessages);
    // Save locally
    if (mergedMessages.length > 0) {
      await AsyncStorage.setItem(`chat_${myUserId}_${id}`, JSON.stringify(mergedMessages));
      await AsyncStorage.setItem(`last_interaction_${myUserId}_${id}`, new Date().getTime().toString()).catch(()=>{});
    }

    // Completely delete fetched remote messages from database
    const remoteReceivedIds = data.filter(m => m.receiver_id === myUserId).map(m => m.id);
    if (remoteReceivedIds.length > 0) {
      await supabase.from('messages').update({ is_read: true }).in('id', remoteReceivedIds);
      await supabase.from('messages').delete().in('id', remoteReceivedIds);
    }
  };

  const subscribeToMessages = (secret: Uint8Array, myUserId: string) => {
    // ── Remove any existing channel before creating a new one ──
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channelName = `chat:${myUserId}:${id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${myUserId}` },
        async (payload) => {
          if (payload.new.sender_id !== id) return;
          try {
            const baseType = payload.new.type?.split(':')[0] || 'text';
            const isImage = baseType === 'image' || baseType === 'image-once';
            const content = isImage
              ? await decryptFile(payload.new.encrypted_content, payload.new.nonce, secret)
              : await decryptText(payload.new.encrypted_content, payload.new.nonce, secret);

            if (content) {
              const expiryStr = payload.new.type?.split(':')[1];
              const expirySeconds = expiryStr ? parseInt(expiryStr, 10) : null;
              const localExpiresAt = expirySeconds ? new Date(Date.now() + expirySeconds * 1000).toISOString() : payload.new.expires_at;

              const newMsg = {
                id: payload.new.id,
                text: content,
                type: payload.new.type,
                sender: 'other',
                timestamp: payload.new.created_at,
                expiresAt: localExpiresAt,
              };

              setMessages(prev => {
                const updated = [...prev, newMsg];
                AsyncStorage.setItem(`chat_${myUserId}_${id}`, JSON.stringify(updated)).catch(()=>{});
                AsyncStorage.setItem(`last_interaction_${myUserId}_${id}`, new Date().getTime().toString()).catch(()=>{});
                return updated;
              });
              
              // Delete from Supabase once received, but mark as read first
              await supabase.from('messages').update({ is_read: true }).eq('id', payload.new.id);
              await supabase.from('messages').delete().eq('id', payload.new.id);
            } else {
              console.warn('[Crypto] RT decrypt failed for incoming msg', payload.new.id);
            }
          } catch (e) { console.error('[Crypto] RT decrypt error', e); }
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] channel status:', status);
      });

    // Store channel ref for cleanup
    channelRef.current = channel;
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMessages(prev => prev.filter(m => !m.expiresAt || new Date(m.expiresAt) > now));
    }, 1000);
    return () => {
      clearInterval(timer);
      if (session?.user?.id && id) {
        AsyncStorage.setItem(`last_read_${session.user.id}_${id}`, String(Date.now())).catch(() => {});
      }
      // Channel cleanup is handled in the initChat useEffect
    };
  }, []);

  const handleSend = async (type = 'text', content = message) => {
    if (!content.trim() || !session?.user || !sharedSecretRef.current) return;
    try {
      const secret = sharedSecretRef.current;
      const baseType = type.split(':')[0];
      const isImage = baseType === 'image' || baseType === 'image-once';
      const { encrypted, nonce } = isImage
        ? await encryptFile(content, secret)
        : await encryptText(content, secret);

      const typeStr = expiry ? `${type}:${expiry}` : type;
      const { data, error } = await supabase.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: id,
        encrypted_content: encrypted,
        nonce,
        type: typeStr,
        is_read: false,
        expires_at: null, // Keep null in DB so it doesn't expire before the receiver sees it
      }).select().single();

      if (error) throw error;

      const newMsg = {
        id: data.id,
        text: content,
        type: typeStr,
        sender: 'me',
        timestamp: data.created_at,
        expiresAt: expiry ? new Date(Date.now() + expiry * 1000).toISOString() : null, // Set locale expiry for sender
      };

      setMessages(prev => {
         const updated = [...prev, newMsg];
         AsyncStorage.setItem(`chat_${session.user.id}_${id}`, JSON.stringify(updated)).catch(()=>{});
         AsyncStorage.setItem(`last_interaction_${session.user.id}_${id}`, new Date().getTime().toString()).catch(()=>{});
         return updated;
      });
      setMessage('');
    } catch (err) {
      Alert.alert('Error', 'Failed to send message');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      handleSend('image', result.assets[0].base64);
    }
  };

  // Deletes ALL messages in this conversation from the DB (both sides)
  // Used when old messages can't be decrypted due to key rotation
  const clearHistory = () => {
    Alert.alert(
      '🗑️ Effacer la conversation',
      'Les messages chiffrés avec d&apos;anciennes clés sont illisibles. Voulez-vous supprimer toute la conversation ?\n\nCette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer',
          style: 'destructive',
          onPress: async () => {
            if (!session?.user) return;
            // Delete locally as well
            await AsyncStorage.removeItem(`chat_${session.user.id}_${id}`);
            
            // Delete remote
            await supabase.from('messages').delete()
              .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${session.user.id})`);
            setMessages([]);
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <X color={Theme.colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{username}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowExpiryModal(true)} style={styles.expiryBtn}>
            <Clock color={expiry ? Theme.colors.primary : Theme.colors.textSecondary} size={22} />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearHistory} style={styles.expiryBtn}>
            <Trash2 color={Theme.colors.textSecondary} size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {isInitializing ? (
        <LoadingScreen speed={80} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isLocked = item.text === LOCKED_TEXT;
            return (
              <View style={[styles.messageContainer, item.sender === 'me' ? styles.myMessage : styles.otherMessage, isLocked && styles.lockedMessage]}>
                {(item.type?.startsWith('image') && !isLocked)
                  ? <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} />
                  : <Text style={[styles.messageText, isLocked && styles.lockedText]}>{item.text}</Text>
                }
                <Text style={styles.messageTime}>
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            );
          }}
          style={styles.list}
          ListHeaderComponent={() => {
            // Show banner if ALL messages are unreadable
            const allLocked = messages.length > 0 && messages.every(m => m.text === LOCKED_TEXT);
            if (!allLocked) return null;
            return (
              <View style={styles.keyErrorBanner}>
                <Text style={styles.keyErrorTitle}>🔐 Clés de chiffrement modifiées</Text>
                <Text style={styles.keyErrorBody}>
                  Ces messages ont été chiffrés avec d&apos;anciennes clés qui ne sont plus disponibles sur cet appareil. Ils sont définitivement inaccessibles.
                </Text>
                <TouchableOpacity style={styles.keyErrorBtn} onPress={clearHistory}>
                  <Trash2 size={14} color="#fff" />
                  <Text style={styles.keyErrorBtnText}>Effacer la conversation</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      <View style={styles.inputArea}>
        <TouchableOpacity onPress={() => setShowGallery(true)} style={styles.actionBtn}>
          <Camera color={Theme.colors.textSecondary} size={24} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Message sécurisé..."
          placeholderTextColor={Theme.colors.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
          editable={!isInitializing}
        />
        <TouchableOpacity onPress={() => handleSend()} style={styles.sendBtn} disabled={isInitializing}>
          <Send color={isInitializing ? Theme.colors.textSecondary : Theme.colors.primary} size={24} />
        </TouchableOpacity>
      </View>

      <Modal visible={showExpiryModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Expiration du message</Text>
            {EXPIRY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.label}
                style={styles.modalOption}
                onPress={() => { setExpiry(opt.seconds); setShowExpiryModal(false); }}
              >
                <Text style={[styles.modalOptionText, expiry === opt.seconds && { color: Theme.colors.primary }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <Modal visible={showGallery} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalOption} onPress={() => { pickImage(); setShowGallery(false); }}>
              <ImageIcon color={Theme.colors.text} size={24} />
              <Text style={styles.modalOptionText}>Galerie</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalOption} onPress={() => setShowGallery(false)}>
              <Text style={[styles.modalOptionText, { color: 'red' }]}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: Theme.spacing.md, borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border, paddingTop: 50,
  },
  backBtn: { padding: Theme.spacing.sm },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Theme.colors.text, textAlign: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  expiryBtn: { padding: Theme.spacing.sm },
  list: { flex: 1, padding: Theme.spacing.md },
  messageContainer: {
    maxWidth: '80%', padding: Theme.spacing.md, borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.md,
  },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#007AFF', borderBottomRightRadius: 0 },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: Theme.colors.surface, borderBottomLeftRadius: 0 },
  lockedMessage: { opacity: 0.5, borderWidth: 1, borderColor: Theme.colors.border, borderStyle: 'dashed' },
  messageText: { color: '#FFFFFF', fontSize: 16 },
  lockedText: { color: Theme.colors.textSecondary, fontSize: 13, fontStyle: 'italic' },
  messageImage: { width: 200, height: 200, borderRadius: Theme.borderRadius.md },
  messageTime: { fontSize: 10, color: 'rgba(255,255,255,0.7)', alignSelf: 'flex-end', marginTop: 4 },
  inputArea: {
    flexDirection: 'row', alignItems: 'center',
    padding: Theme.spacing.md, borderTopWidth: 1,
    borderTopColor: Theme.colors.border, backgroundColor: Theme.colors.background,
  },
  input: {
    flex: 1, backgroundColor: Theme.colors.surface, borderRadius: 20,
    paddingHorizontal: Theme.spacing.md, paddingVertical: 8,
    color: Theme.colors.text, marginHorizontal: Theme.spacing.sm, maxHeight: 100,
  },
  actionBtn: { padding: Theme.spacing.sm },
  sendBtn: { padding: Theme.spacing.sm },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: {
    backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.xl,
    padding: Theme.spacing.xl, width: '80%', gap: Theme.spacing.md,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Theme.colors.text, marginBottom: Theme.spacing.md, textAlign: 'center' },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, paddingVertical: Theme.spacing.md },
  modalOptionText: { fontSize: 18, color: Theme.colors.text },
  keyErrorBanner: {
    backgroundColor: Theme.colors.surface,
    padding: Theme.spacing.lg,
    borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    alignItems: 'center',
  },
  keyErrorTitle: {
    color: Theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: Theme.spacing.xs,
  },
  keyErrorBody: {
    color: Theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  keyErrorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.borderRadius.md,
    gap: Theme.spacing.xs,
  },
  keyErrorBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
