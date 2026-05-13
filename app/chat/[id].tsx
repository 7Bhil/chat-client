import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, KeyboardAvoidingView, Platform, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { decryptMessage, deriveSharedSecret, calculateRatchetKey, encryptWithRatchet, decryptWithRatchet } from '../../utils/encryption';
import { getPrivateKey } from '../../utils/api';
import { useAuth } from '../../utils/AuthContext';
import { supabase } from '../../utils/supabase';
import { Shield, Send, ArrowLeft, Lock } from 'lucide-react-native';

export default function ChatDetailScreen() {
  const { id, username, publicKey } = useLocalSearchParams();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const { session } = useAuth();
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  // 1. Fetch History and setup Realtime
  useEffect(() => {
    if (!session?.user || !id) return;

    const fetchHistory = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${session.user.id})`)
        .order('created_at', { ascending: true });

      if (error) return;

      const privKey = await getPrivateKey();
      if (!privKey) return;

      // Setup Ratchet base
      const sharedSecret = deriveSharedSecret(privKey, publicKey as string);

      const processedMessages = await Promise.all(data.map(async (msg, index) => {
        // Simple Ratchet logic using the message index in history
        const { messageKey } = calculateRatchetKey(sharedSecret, index);
        
        // Try Ratchet decryption first
        let text = await decryptWithRatchet(msg.encrypted_content, msg.nonce, messageKey);
        
        // Fallback to standard box for old messages
        if (!text) {
          text = await decryptMessage(msg.encrypted_content, publicKey as string, privKey);
        }

        return {
          id: msg.id,
          text: text || '[Decryption Error]',
          sender: msg.sender_id === session.user.id ? 'me' : 'other',
          timestamp: msg.created_at
        };
      }));

      setMessages(processedMessages);
    };

    fetchHistory();

    const channel = supabase
      .channel(`chat:${id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `receiver_id=eq.${session.user.id}` 
      }, async (payload) => {
        if (payload.new.sender_id !== id) return;

        const privKey = await getPrivateKey();
        if (privKey) {
          const sharedSecret = deriveSharedSecret(privKey, publicKey as string);
          
          // Current strategy: Use a timestamp-based or count-based index
          // For simplicity, we use the messages length
          const { messageKey } = calculateRatchetKey(sharedSecret, messages.length);
          
          let decrypted = await decryptWithRatchet(payload.new.encrypted_content, payload.new.nonce, messageKey);
          
          // Fallback
          if (!decrypted) {
            decrypted = await decryptMessage(payload.new.encrypted_content, publicKey as string, privKey);
          }

          setMessages(prev => [...prev, {
            id: payload.new.id,
            text: decrypted || '[Decryption Error]',
            sender: 'other',
            timestamp: payload.new.created_at
          }]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, id, publicKey, messages.length]);

  const handleSend = async () => {
    if (!message.trim() || !session?.user) return;

    try {
      const privKey = await getPrivateKey();
      if (!privKey) return;

      const sharedSecret = deriveSharedSecret(privKey, publicKey as string);
      const { messageKey } = calculateRatchetKey(sharedSecret, messages.length);

      // Perform Ratchet Encryption
      const { encrypted, nonce } = await encryptWithRatchet(message, messageKey);

      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: session.user.id,
          receiver_id: id,
          encrypted_content: encrypted,
          nonce: nonce, 
        })
        .select()
        .single();

      if (error) throw error;

      setMessages(prev => [...prev, {
        id: data.id,
        text: message,
        sender: 'me',
        timestamp: data.created_at
      }]);

      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      Alert.alert('Error', 'Message could not be sent');
    }
  };


  const renderMessage = ({ item }: { item: any }) => (
    <View style={[
      styles.messageContainer,
      item.sender === 'me' ? styles.myMessage : styles.otherMessage
    ]}>
      <Text style={[
          styles.messageText,
          item.sender !== 'me' && styles.otherMessageText
      ]}>{item.text}</Text>
      <Text style={[
          styles.timestamp,
          item.sender !== 'me' && styles.otherTimestamp
      ]}>
        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerUsername}>{username}</Text>
          <View style={styles.encryptionBadge}>
            <Lock size={12} color={Theme.colors.primary} />
            <Text style={styles.encryptionText}>End-to-End Encrypted</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          placeholder="Type a secure message..."
          placeholderTextColor={Theme.colors.textSecondary}
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <TouchableOpacity 
          style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]} 
          onPress={handleSend}
          disabled={!message.trim()}
        >
          <Send size={20} color={Theme.colors.background} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.md,
    backgroundColor: Theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  backBtn: {
    padding: Theme.spacing.sm,
  },
  headerInfo: {
    marginLeft: Theme.spacing.sm,
  },
  headerUsername: {
    fontSize: 18,
    fontWeight: '700',
    color: Theme.colors.text,
  },
  encryptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  encryptionText: {
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: '600',
  },
  messageList: {
    padding: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl,
  },
  messageContainer: {
    maxWidth: '80%',
    padding: Theme.spacing.md,
    borderRadius: Theme.borderRadius.lg,
    marginBottom: Theme.spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: Theme.colors.primary,
    borderBottomRightRadius: 2,
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: Theme.colors.surface,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  messageText: {
    color: '#000',
    fontSize: 15,
    lineHeight: 20,
  },
  otherMessageText: {
    color: Theme.colors.text,
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.5)',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  otherTimestamp: {
    color: Theme.colors.textSecondary,
  },
  inputArea: {
    flexDirection: 'row',
    padding: Theme.spacing.md,
    backgroundColor: Theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    alignItems: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 30 : Theme.spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.borderRadius.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
    paddingTop: Theme.spacing.sm,
    color: Theme.colors.text,
    fontSize: 15,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Theme.spacing.sm,
  },
  sendBtnDisabled: {
    backgroundColor: Theme.colors.textSecondary,
    opacity: 0.5,
  },
});

