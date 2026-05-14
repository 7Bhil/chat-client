import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../utils/AuthContext';
import { encryptText, decryptText, deriveSharedSecret, encryptFile, decryptFile } from '../../utils/encryption';
import { getPrivateKey } from '../../utils/api';
import { Send, Camera, Image as ImageIcon, Trash2, Clock, Eye, Download, X } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenCapture from 'expo-screen-capture';
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
  const [activePublicKey, setActivePublicKey] = useState<string | null>(initialPublicKey as string || null);
  const activePublicKeyRef = useRef<string | null>(initialPublicKey as string || null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (session?.user && id) {
      fetchHistory();
      const subscription = subscribeToMessages();
      return () => { subscription.unsubscribe(); };
    }
  }, [session, id]);

  const fetchHistory = async () => {
    try {
      if (!session?.user || !id) return;
      
      const { data: profile } = await supabase.from('profiles').select('public_key').eq('id', id).single();
      if (profile?.public_key) {
        const cleanKey = profile.public_key.trim();
        activePublicKeyRef.current = cleanKey;
        setActivePublicKey(cleanKey);
      }

      const privKeyRaw = await getPrivateKey(session.user.id);
      const privKey = privKeyRaw?.trim();
      const currentPub = activePublicKeyRef.current;

      if (!privKey || !currentPub) {
        setIsInitializing(false);
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${session.user.id})`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const sharedSecret = deriveSharedSecret(privKey, currentPub);
      const decodedMessages = await Promise.all((data || []).map(async (msg) => {
        try {
          const isMe = msg.sender_id === session.user.id;
          let content = '';
          const typeParts = msg.type.split(':');
          const baseType = typeParts[0];

          if (msg.expires_at && new Date(msg.expires_at) < new Date()) return null;

          if (baseType === 'image' || baseType === 'image-once') {
            content = await decryptFile(msg.encrypted_content, msg.nonce, sharedSecret) || '';
          } else {
            content = await decryptText(msg.encrypted_content, msg.nonce, currentPub, privKey) || '[Decryption Error]';
          }

          return {
            id: msg.id,
            text: content,
            type: msg.type,
            sender: isMe ? 'me' : 'other',
            timestamp: msg.created_at,
            isRead: msg.is_read,
            expiresAt: msg.expires_at,
          };
        } catch (e) {
          return { id: msg.id, text: '[Decryption Error]', type: 'text', sender: msg.sender_id === session.user.id ? 'me' : 'other', timestamp: msg.created_at };
        }
      }));

      setMessages(decodedMessages.filter(m => m !== null));
      setIsInitializing(false);
      
      // Mark as read
      await supabase.from('messages').update({ is_read: true }).eq('receiver_id', session.user.id).eq('sender_id', id);
    } catch (err) {
      console.error("fetchHistory error:", err);
      setIsInitializing(false);
    }
  };

  const subscribeToMessages = () => {
    return supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, async (payload) => {
        if (payload.new.sender_id !== id) return;
        
        const privKeyRaw = await getPrivateKey(session!.user.id);
        const privKey = privKeyRaw?.trim();
        const currentPub = activePublicKeyRef.current;

        if (privKey && currentPub) {
          try {
            const sharedSecret = deriveSharedSecret(privKey, currentPub);
            let baseType = payload.new.type.split(':')[0];
            let decrypted = (baseType === 'image' || baseType === 'image-once') 
              ? await decryptFile(payload.new.encrypted_content, payload.new.nonce, sharedSecret)
              : await decryptText(payload.new.encrypted_content, payload.new.nonce, currentPub, privKey);

            if (decrypted) {
              const newMsg = {
                id: payload.new.id,
                text: decrypted,
                type: payload.new.type,
                sender: 'other',
                timestamp: payload.new.created_at,
                isRead: true,
                expiresAt: payload.new.expires_at
              };
              setMessages(prev => [...prev, newMsg]);
              await supabase.from('messages').update({ is_read: true }).eq('id', payload.new.id);
            }
          } catch (e) { console.error("Realtime decrypt error", e); }
        }
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
        AsyncStorage.setItem(`last_read_${session.user.id}_${id}`, new Date().getTime().toString()).catch(() => {});
      }
    };
  }, [session, id]);

  const handleSend = async (type = 'text', content = message) => {
    if (!content.trim() || !session?.user || isInitializing) return;

    try {
      const privKeyRaw = await getPrivateKey(session.user.id);
      const privKey = privKeyRaw?.trim();
      const currentPub = activePublicKeyRef.current;
      
      if (!privKey || !currentPub) throw new Error("Keys not ready");

      const { encrypted, nonce } = (type === 'image' || type === 'image-once')
        ? await encryptFile(content, deriveSharedSecret(privKey, currentPub))
        : await encryptText(content, currentPub, privKey);

      const typeStr = expiry ? `${type}:${expiry}` : type;
      const { data, error } = await supabase.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: id,
        encrypted_content: encrypted,
        nonce: nonce,
        type: typeStr,
        is_read: false,
        expires_at: expiry ? new Date(Date.now() + expiry * 1000).toISOString() : null
      }).select().single();

      if (error) throw error;
      setMessages(prev => [...prev, { id: data.id, text: content, type: typeStr, sender: 'me', timestamp: data.created_at, isRead: false, expiresAt: data.expires_at }]);
      setMessage('');
      supabase.from('messages').update({ is_read: true }).eq('receiver_id', session.user.id).eq('sender_id', id).then();
    } catch (error) { Alert.alert('Error', 'Failed to send'); }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      handleSend(expiry ? 'image-once' : 'image', result.assets[0].base64);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      {isInitializing && <LoadingScreen speed={80} />}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <X color={Theme.colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{username}</Text>
        <TouchableOpacity onPress={() => setShowExpiryModal(true)} style={styles.expiryBtn}>
          <Clock color={expiry ? Theme.colors.primary : Theme.colors.textSecondary} size={24} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        renderItem={({ item }) => (
          <View style={[styles.messageContainer, item.sender === 'me' ? styles.myMessage : styles.otherMessage]}>
            {item.type.startsWith('image') ? (
              <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} />
            ) : (
              <Text style={styles.messageText}>{item.text}</Text>
            )}
            <Text style={styles.messageTime}>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
        )}
        style={styles.list}
      />

      <View style={styles.inputArea}>
        <TouchableOpacity onPress={() => setShowGallery(true)} style={styles.actionBtn}>
          <Camera color={Theme.colors.textSecondary} size={24} />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Secure message..."
          placeholderTextColor={Theme.colors.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <TouchableOpacity onPress={() => handleSend()} style={styles.sendBtn}>
          <Send color={Theme.colors.primary} size={24} />
        </TouchableOpacity>
      </View>

      <Modal visible={showExpiryModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Message Expiration</Text>
            {EXPIRY_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.label} style={styles.modalOption} onPress={() => { setExpiry(opt.seconds); setShowExpiryModal(false); }}>
                <Text style={[styles.modalOptionText, expiry === opt.seconds && { color: Theme.colors.primary }]}>{opt.label}</Text>
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
              <Text style={styles.modalOptionText}>Gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalOption} onPress={() => setShowGallery(false)}>
              <Text style={[styles.modalOptionText, { color: 'red' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: Theme.spacing.md, borderBottomWidth: 1, borderBottomColor: Theme.colors.border, paddingTop: 50 },
  backBtn: { padding: Theme.spacing.sm },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Theme.colors.text, textAlign: 'center' },
  expiryBtn: { padding: Theme.spacing.sm },
  list: { flex: 1, padding: Theme.spacing.md },
  messageContainer: { maxWidth: '80%', padding: Theme.spacing.md, borderRadius: Theme.borderRadius.lg, marginBottom: Theme.spacing.md, position: 'relative' },
  myMessage: { alignSelf: 'flex-end', backgroundColor: Theme.colors.primary + '20', borderBottomRightRadius: 0 },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: Theme.colors.surface, borderBottomLeftRadius: 0 },
  messageText: { color: Theme.colors.text, fontSize: 16 },
  messageImage: { width: 200, height: 200, borderRadius: Theme.borderRadius.md },
  messageTime: { fontSize: 10, color: Theme.colors.textSecondary, alignSelf: 'flex-end', marginTop: 4 },
  inputArea: { flexDirection: 'row', alignItems: 'center', padding: Theme.spacing.md, borderTopWidth: 1, borderTopColor: Theme.colors.border, backgroundColor: Theme.colors.background },
  input: { flex: 1, backgroundColor: Theme.colors.surface, borderRadius: 20, paddingHorizontal: Theme.spacing.md, paddingVertical: 8, color: Theme.colors.text, marginHorizontal: Theme.spacing.sm, maxHeight: 100 },
  actionBtn: { padding: Theme.spacing.sm },
  sendBtn: { padding: Theme.spacing.sm },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: Theme.colors.surface, borderRadius: Theme.borderRadius.xl, padding: Theme.spacing.xl, width: '80%', gap: Theme.spacing.md },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Theme.colors.text, marginBottom: Theme.spacing.md, textAlign: 'center' },
  modalOption: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, paddingVertical: Theme.spacing.md },
  modalOptionText: { fontSize: 18, color: Theme.colors.text },
});
