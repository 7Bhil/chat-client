import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, KeyboardAvoidingView, Platform, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import { encryptMessage, decryptMessage } from '../../utils/encryption';
import { getPrivateKey, getUser } from '../../utils/api';
import { useSocket } from '../../utils/SocketContext';
import { Shield, Send, ArrowLeft, Lock } from 'lucide-react-native';

export default function ChatDetailScreen() {
  const { id, username, publicKey } = useLocalSearchParams();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const { socket } = useSocket();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const router = useRouter();
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    getUser().then(setCurrentUser);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = async (data: any) => {
      // data: { from, encryptedMessage, timestamp }
      if (data.from !== id) return;

      const privKey = await getPrivateKey();
      if (!privKey) return;

      const decrypted = await decryptMessage(data.encryptedMessage, publicKey as string, privKey);
      if (decrypted) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: decrypted,
          sender: 'other',
          timestamp: data.timestamp
        }]);
      }
    };

    socket.on('new_message', handleNewMessage);
    return () => {
      socket.off('new_message');
    };
  }, [socket, id, publicKey]);

  const handleSend = async () => {
    if (!message.trim() || !socket || !currentUser) return;

    try {
      const privKey = await getPrivateKey();
      if (!privKey) {
        Alert.alert('Error', 'Private key not found. Re-login required.');
        return;
      }

      // 1. Encrypt message for recipient
      const encrypted = await encryptMessage(message, publicKey as string, privKey);

      // 2. Send via socket
      socket.emit('private_message', {
        to: id,
        from: currentUser.id,
        encryptedMessage: encrypted,
      });

      // 3. Add to local state (unencrypted for self)
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: message,
        sender: 'me',
        timestamp: new Date()
      }]);

      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
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
    color: '#000', // Best for bright cyan bg
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
