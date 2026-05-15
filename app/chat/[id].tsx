import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../utils/AuthContext';
import { encryptText, decryptText, deriveSharedSecret, encryptFile, decryptFile } from '../../utils/encryption';
import { getPrivateKey } from '../../utils/api';
import { Send, Camera, Image as ImageIcon, Clock, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LoadingScreen } from '../../components/LoadingScreen';

const EXPIRY_OPTIONS = [
  { label: 'Off', seconds: null },
  { label: '5s', seconds: 5 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
];

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

  useEffect(() => {
    if (session?.user && id) {
      initChat();
    }
  }, [session?.user?.id, id]);

  const initChat = async () => {
    if (!session?.user) return;
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
        setIsInitializing(false);
        return;
      }
      const theirPubKey = profile.public_key.trim();

      // 2. Get MY private key — strictly tied to my user ID
      const myPrivKey = await getPrivateKey(session.user.id);
      if (!myPrivKey) {
        Alert.alert('Error', 'Your encryption key is missing. Please log out and log back in.');
        setIsInitializing(false);
        return;
      }

      // 3. Compute shared secret ONCE and keep it in a ref
      sharedSecretRef.current = deriveSharedSecret(myPrivKey.trim(), theirPubKey);

      // 4. Fetch message history
      await fetchHistory(sharedSecretRef.current, session.user.id);

      // 5. Subscribe to new messages
      subscribeToMessages(sharedSecretRef.current, session.user.id);

      // 6. Mark all as read
      await supabase.from('messages')
        .update({ is_read: true })
        .eq('receiver_id', session.user.id)
        .eq('sender_id', id);

    } catch (err) {
      console.error('initChat error:', err);
    } finally {
      setIsInitializing(false);
    }
  };

  const fetchHistory = async (secret: Uint8Array, myUserId: string) => {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${myUserId},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${myUserId})`)
      .order('created_at', { ascending: true });

    if (error || !data) return;

    const decoded = await Promise.all(data.map(async (msg) => {
      try {
        if (msg.expires_at && new Date(msg.expires_at) < new Date()) return null;
        const baseType = msg.type?.split(':')[0] || 'text';
        const isImage = baseType === 'image' || baseType === 'image-once';
        const content = isImage
          ? await decryptFile(msg.encrypted_content, msg.nonce, secret)
          : await decryptText(msg.encrypted_content, msg.nonce, secret);

        return {
          id: msg.id,
          text: content ?? '[Clés désynchronisées ou version incompatible]',
          type: msg.type,
          sender: msg.sender_id === myUserId ? 'me' : 'other',
          timestamp: msg.created_at,
          expiresAt: msg.expires_at,
        };
      } catch {
        return null;
      }
    }));

    setMessages(decoded.filter(Boolean) as any[]);
  };

  const subscribeToMessages = (secret: Uint8Array, myUserId: string) => {
    supabase
      .channel(`chat:${id}:${myUserId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${myUserId}` }, async (payload) => {
        if (payload.new.sender_id !== id) return;
        try {
          const baseType = payload.new.type?.split(':')[0] || 'text';
          const isImage = baseType === 'image' || baseType === 'image-once';
          const content = isImage
            ? await decryptFile(payload.new.encrypted_content, payload.new.nonce, secret)
            : await decryptText(payload.new.encrypted_content, payload.new.nonce, secret);

          if (content) {
            setMessages(prev => [...prev, {
              id: payload.new.id,
              text: content,
              type: payload.new.type,
              sender: 'other',
              timestamp: payload.new.created_at,
              expiresAt: payload.new.expires_at,
            }]);
            await supabase.from('messages').update({ is_read: true }).eq('id', payload.new.id);
          }
        } catch (e) { console.error('RT decrypt error', e); }
      })
      .subscribe();
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
    };
  }, [session?.user?.id, id]);

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
        expires_at: expiry ? new Date(Date.now() + expiry * 1000).toISOString() : null,
      }).select().single();

      if (error) throw error;

      setMessages(prev => [...prev, {
        id: data.id,
        text: content,
        type: typeStr,
        sender: 'me',
        timestamp: data.created_at,
        expiresAt: data.expires_at,
      }]);
      setMessage('');

      // Mark received messages as read when replying
      supabase.from('messages').update({ is_read: true })
        .eq('receiver_id', session.user.id)
        .eq('sender_id', id)
        .then();
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <X color={Theme.colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{username}</Text>
        <TouchableOpacity onPress={() => setShowExpiryModal(true)} style={styles.expiryBtn}>
          <Clock color={expiry ? Theme.colors.primary : Theme.colors.textSecondary} size={24} />
        </TouchableOpacity>
      </View>

      {isInitializing ? (
        <LoadingScreen speed={80} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => (
            <View style={[styles.messageContainer, item.sender === 'me' ? styles.myMessage : styles.otherMessage]}>
              {(item.type?.startsWith('image'))
                ? <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} />
                : <Text style={styles.messageText}>{item.text}</Text>
              }
              <Text style={styles.messageTime}>
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
          style={styles.list}
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
  expiryBtn: { padding: Theme.spacing.sm },
  list: { flex: 1, padding: Theme.spacing.md },
  messageContainer: {
    maxWidth: '80%', padding: Theme.spacing.md, borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.md,
  },
  myMessage: { alignSelf: 'flex-end', backgroundColor: Theme.colors.primary + '30', borderBottomRightRadius: 0 },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: Theme.colors.surface, borderBottomLeftRadius: 0 },
  messageText: { color: Theme.colors.text, fontSize: 16 },
  messageImage: { width: 200, height: 200, borderRadius: Theme.borderRadius.md },
  messageTime: { fontSize: 10, color: Theme.colors.textSecondary, alignSelf: 'flex-end', marginTop: 4 },
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
});
