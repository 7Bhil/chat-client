import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, KeyboardAvoidingView, Platform, TouchableOpacity, Alert, Image, Modal, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { deriveSharedSecret, encryptFile, decryptFile, encryptText, decryptText } from '../../utils/encryption';
import { getPrivateKey } from '../../utils/api';
import { useAuth } from '../../utils/AuthContext';
import { supabase } from '../../utils/supabase';
import { Shield, Send, ArrowLeft, Lock, Image as ImageIcon, Clock, Trash2, LayoutGrid, X, Phone, Video } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenCapture from 'expo-screen-capture';

const EXPIRY_OPTIONS = [
  { label: 'Off', seconds: null },
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '30m', seconds: 1800 },
];

export default function ChatDetailScreen() {
  const { id, username, publicKey } = useLocalSearchParams();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showCall, setShowCall] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const { session } = useAuth();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  // 1. Screen Capture Protection
  useEffect(() => {
    let subscription: any;
    try {
      ScreenCapture.preventScreenCaptureAsync().catch(err => console.warn('preventScreenCaptureAsync not supported:', err));
      
      subscription = ScreenCapture.addScreenshotListener(() => {
        Alert.alert(
          'Security Warning',
          'Capture detected! For security reasons, do not take screenshots of private conversations.',
          [{ text: 'OK', style: 'destructive' }]
        );
      });
    } catch (err) {
      console.warn("ScreenCapture not fully supported:", err);
    }

    return () => { 
      try {
        ScreenCapture.allowScreenCaptureAsync().catch(() => {});
        if (subscription) subscription.remove();
      } catch (e) {}
    };
  }, []);


  // 2. Main Logic
  useEffect(() => {
    if (!session?.user || !id) return;

    const fetchHistory = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${session.user.id})`)
          .order('created_at', { ascending: true });

        if (error) throw error;

        const privKey = await getPrivateKey();
        if (!privKey) {
            console.warn("Private key missing, cannot decrypt history.");
            return;
        }

        if (!publicKey) {
            console.warn("Public key missing for this specific user. Maybe it's an old account?");
            setMessages(data || []);
            return;
        }

        const sharedSecret = deriveSharedSecret(privKey, publicKey as string);

        const processed = await Promise.all(data.map(async (msg) => {
          try {
            let content = null;
            
            // Hide expired messages locally immediately
            if (msg.expires_at && new Date(msg.expires_at) < new Date()) return null;

            if (msg.type === 'image') {
              // File encryption still uses sharedSecret (secretbox)
              content = await decryptFile(msg.encrypted_content, msg.nonce, sharedSecret);
            } else {
              content = await decryptText(msg.encrypted_content, msg.nonce, sharedSecret);
            }

            return {
              id: msg.id,
              text: content || '[Decryption Error]',
              type: msg.type,
              sender: msg.sender_id === session.user.id ? 'me' : 'other',
              timestamp: msg.created_at,
              isRead: msg.is_read,
              expiresAt: msg.expires_at
            };
          } catch (decErr) {
            console.error("Message decryption error:", decErr);
            return {
              id: msg.id,
              text: '[Encrypted Message]',
              type: 'text',
              sender: msg.sender_id === session.user.id ? 'me' : 'other',
              timestamp: msg.created_at,
              isRead: msg.is_read
            };
          }
        }));

        setMessages(processed.filter(m => m !== null));
        await supabase.from('messages').update({ is_read: true }).eq('receiver_id', session.user.id).eq('sender_id', id);
      } catch (err) {
        console.error("fetchHistory error:", err);
      }
    };

    fetchHistory();

    const channel = supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${session.user.id}` }, async (payload) => {
        if (payload.new.sender_id !== id) return;
        const privKey = await getPrivateKey();
        if (privKey) {
          const sharedSecret = deriveSharedSecret(privKey, publicKey as string);
          let decrypted = payload.new.type === 'image' 
            ? await decryptFile(payload.new.encrypted_content, payload.new.nonce, sharedSecret)
            : await decryptText(payload.new.encrypted_content, payload.new.nonce, sharedSecret);

          setMessages(prev => [...prev, {
            id: payload.new.id, text: decrypted || '[Decryption Error]', type: payload.new.type, sender: 'other', timestamp: payload.new.created_at, expiresAt: payload.new.expires_at
          }]);
          await supabase.from('messages').update({ is_read: true }).eq('id', payload.new.id);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, isRead: payload.new.is_read } : m));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
          setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session, id, messages.length]);

  // Handle local disappearance
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setMessages(prev => prev.filter(m => !m.expiresAt || new Date(m.expiresAt) > now));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSend = async (type = 'text', content = message) => {
    if (!content.trim() || !session?.user) return;
    try {
      const privKey = await getPrivateKey();
      const sharedSecret = deriveSharedSecret(privKey!, publicKey as string);

      const { encrypted, nonce } = type === 'image' 
        ? await encryptFile(content, sharedSecret)
        : await encryptText(content, sharedSecret);

      const expiresAt = expiry ? new Date(Date.now() + expiry * 1000).toISOString() : null;

      const { data, error } = await supabase.from('messages').insert({
        sender_id: session.user.id,
        receiver_id: id,
        encrypted_content: encrypted,
        nonce: nonce,
        type: type,
        expires_at: expiresAt
      }).select().single();

      if (error) throw error;
      setMessages(prev => [...prev, { id: data.id, text: content, type, sender: 'me', timestamp: data.created_at, isRead: false, expiresAt }]);
      setMessage('');
    } catch (error) { Alert.alert('Error', 'Failed to send'); }
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.5 });
    if (!result.canceled && result.assets[0].base64) handleSend('image', result.assets[0].base64);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ArrowLeft size={24} color={Theme.colors.text} /></TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerUsername}>{username}</Text>
          <View style={styles.encryptionBadge}><Lock size={12} color={Theme.colors.primary} /><Text style={styles.encryptionText}>End-to-End Encrypted</Text></View>
        </View>
        <TouchableOpacity onPress={() => setShowGallery(true)} style={styles.galleryBtn}>
          <LayoutGrid size={20} color={Theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setCallType('audio'); setShowCall(true); }} style={styles.galleryBtn}>
          <Phone size={20} color={Theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setCallType('video'); setShowCall(true); }} style={styles.galleryBtn}>
          <Video size={20} color={Theme.colors.text} />
        </TouchableOpacity>
      </View>

      <FlatList ref={flatListRef} data={messages} keyExtractor={(item) => item.id} renderItem={({item}) => (
        <View style={[styles.messageContainer, item.sender === 'me' ? styles.myMessage : styles.otherMessage]}>
          {item.expiresAt && <Trash2 size={12} color={Theme.colors.textSecondary} style={{position:'absolute', top: 5, right: 5}} />}
          {item.type === 'image' ? <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.messageImage} /> : <Text style={[styles.messageText, item.sender !== 'me' && styles.otherMessageText]}>{item.text}</Text>}
          <View style={styles.messageFooter}>
            <Text style={[styles.timestamp, item.sender !== 'me' && styles.otherTimestamp]}>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            {item.sender === 'me' && <Text style={styles.readStatus}>{item.isRead ? '✓✓' : '✓'}</Text>}
          </View>
        </View>
      )} contentContainerStyle={styles.messageList} onContentSizeChange={() => flatListRef.current?.scrollToEnd()} />

      <View style={styles.inputArea}>
        <TouchableOpacity onPress={pickImage} style={styles.attachBtn}>
          <ImageIcon size={24} color={Theme.colors.primary} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          onPress={() => setShowExpiryModal(true)} 
          style={[styles.bottomExpiryBtn, expiry ? styles.bottomExpiryBtnActive : null]}
        >
          <Clock size={20} color={expiry ? Theme.colors.primary : Theme.colors.textSecondary} />
          {expiry && <Text style={styles.bottomExpiryLabel}>{EXPIRY_OPTIONS.find(o => o.seconds === expiry)?.label}</Text>}
        </TouchableOpacity>

        <TextInput style={styles.input} placeholder="Type a secure message..." placeholderTextColor={Theme.colors.textSecondary} value={message} onChangeText={setMessage} multiline />
        <TouchableOpacity style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]} onPress={() => handleSend()} disabled={!message.trim()}><Send size={20} color={Theme.colors.background} /></TouchableOpacity>
      </View>

      <Modal visible={showExpiryModal} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowExpiryModal(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ephemeral Messages</Text>
            {EXPIRY_OPTIONS.map((opt) => (
              <TouchableOpacity key={opt.label} style={styles.optionBtn} onPress={() => { setExpiry(opt.seconds); setShowExpiryModal(false); }}>
                <Text style={[styles.optionText, expiry === opt.seconds && styles.optionTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showGallery} animationType="slide">
        <View style={styles.galleryContainer}>
          <View style={styles.galleryHeader}>
            <TouchableOpacity onPress={() => setShowGallery(false)}><X size={24} color={Theme.colors.text} /></TouchableOpacity>
            <Text style={styles.galleryTitle}>Shared Media</Text>
            <View style={{width: 24}} />
          </View>
          <FlatList
            data={messages.filter(m => m.type === 'image')}
            keyExtractor={(item) => item.id}
            numColumns={3}
            renderItem={({item}) => (
              <Image source={{ uri: `data:image/jpeg;base64,${item.text}` }} style={styles.galleryImage} />
            )}
            contentContainerStyle={styles.galleryList}
            ListEmptyComponent={
              <View style={styles.emptyGallery}><ImageIcon size={48} color={Theme.colors.textSecondary} /><Text style={styles.emptyText}>No media shared yet</Text></View>
            }
          />
        </View>
      </Modal>

      <Modal visible={showCall} animationType="slide">
        <View style={{flex: 1, backgroundColor: '#000'}}>
          <View style={[styles.galleryHeader, {backgroundColor: '#000'}]}>
             <TouchableOpacity onPress={() => setShowCall(false)}><X size={24} color="#fff" /></TouchableOpacity>
             <Text style={{color: '#fff', fontSize: 18, fontWeight: 'bold'}}>Secure Call: {username}</Text>
             <View style={{width: 24}} />
          </View>
          <WebView 
            source={{ uri: `https://meet.jit.si/SecureChat_${(session?.user?.id || '') < (id as string) ? (session?.user?.id || '') + '_' + id : id + '_' + (session?.user?.id || '')}#config.startWithAudioOnly=${callType === 'audio'}` }}
            style={{ flex: 1 }}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background },
  header: { paddingTop: 60, paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.md, backgroundColor: Theme.colors.surface, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Theme.colors.border },
  backBtn: { padding: Theme.spacing.sm },
  headerInfo: { marginLeft: Theme.spacing.sm, flex: 1 },
  headerUsername: { fontSize: 18, fontWeight: '700', color: Theme.colors.text },
  encryptionBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  encryptionText: { fontSize: 10, color: Theme.colors.primary, fontWeight: '600' },
  bottomExpiryBtn: { padding: 10, flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: Theme.spacing.sm },
  bottomExpiryBtnActive: { backgroundColor: 'rgba(0, 255, 255, 0.1)', borderRadius: 12 },
  bottomExpiryLabel: { fontSize: 12, color: Theme.colors.primary, fontWeight: 'bold' },
  messageList: { padding: Theme.spacing.md, paddingBottom: Theme.spacing.xl },
  messageContainer: { maxWidth: '80%', padding: Theme.spacing.md, borderRadius: Theme.borderRadius.lg, marginBottom: Theme.spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: Theme.colors.primary, borderBottomRightRadius: 2 },
  otherMessage: { alignSelf: 'flex-start', backgroundColor: Theme.colors.surface, borderBottomLeftRadius: 2, borderWidth: 1, borderColor: Theme.colors.border },
  messageText: { color: '#000', fontSize: 15, lineHeight: 20 },
  otherMessageText: { color: Theme.colors.text },
  messageImage: { width: 200, height: 200, borderRadius: Theme.borderRadius.md, marginBottom: 4 },
  messageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  timestamp: { fontSize: 10, color: 'rgba(0,0,0,0.5)' },
  otherTimestamp: { color: Theme.colors.textSecondary },
  readStatus: { fontSize: 10, color: 'rgba(0,0,0,0.6)', fontWeight: 'bold' },
  inputArea: { flexDirection: 'row', padding: Theme.spacing.md, backgroundColor: Theme.colors.surface, borderTopWidth: 1, borderTopColor: Theme.colors.border, alignItems: 'flex-end', paddingBottom: Platform.OS === 'ios' ? 30 : Theme.spacing.md },
  attachBtn: { padding: 10 },
  input: { flex: 1, backgroundColor: Theme.colors.background, borderRadius: Theme.borderRadius.xl, paddingHorizontal: Theme.spacing.lg, paddingVertical: Theme.spacing.sm, color: Theme.colors.text, fontSize: 15, maxHeight: 120, borderWidth: 1, borderColor: Theme.colors.border },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: Theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: Theme.spacing.sm },
  sendBtnDisabled: { backgroundColor: Theme.colors.textSecondary, opacity: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: Theme.colors.surface, width: '80%', borderRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, color: Theme.colors.text, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  optionBtn: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Theme.colors.border },
  optionText: { color: Theme.colors.textSecondary, fontSize: 16, textAlign: 'center' },
  optionTextActive: { color: Theme.colors.primary, fontWeight: 'bold' },
  galleryBtn: { padding: 8, marginLeft: 4 },
  galleryContainer: { flex: 1, backgroundColor: Theme.colors.background },
  galleryHeader: { paddingTop: 60, paddingHorizontal: 20, paddingBottom: 20, backgroundColor: Theme.colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  galleryTitle: { fontSize: 18, fontWeight: 'bold', color: Theme.colors.text },
  galleryList: { padding: 2 },
  galleryImage: { width: '33%', aspectRatio: 1, margin: 1, borderRadius: 4 },
  emptyGallery: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyText: { color: Theme.colors.textSecondary, marginTop: Theme.spacing.md, fontSize: 16 },
});

