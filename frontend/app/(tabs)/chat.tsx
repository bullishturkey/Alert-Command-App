import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

interface Channel {
  id: string;
  slug: string;
  name: string;
  description: string;
}

interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

export default function ChatScreen() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const data = await apiFetch('/api/chat/channels');
      const chs = data.channels || [];
      setChannels(chs);
      if (chs.length > 0 && !activeChannel) setActiveChannel(chs[0]);
    } catch (e) {
      console.error('Fetch channels error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!activeChannel) return;
    try {
      const data = await apiFetch(`/api/chat/messages/${activeChannel.id}`);
      setMessages(data.messages || []);
    } catch (e) {
      console.error('Fetch messages error:', e);
    }
  }, [activeChannel]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchMessages(); const interval = setInterval(fetchMessages, 5000); return () => clearInterval(interval); }, [fetchMessages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChannel) return;
    setSending(true);
    try {
      await apiFetch(`/api/chat/messages/${activeChannel.id}`, {
        method: 'POST',
        body: JSON.stringify({ content: newMessage.trim() }),
      });
      setNewMessage('');
      await fetchMessages();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.error('Send message error:', e);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.user_id === user?.id;
    return (
      <View testID={`message-${item.id}`} style={[styles.messageBubble, isMe && styles.messageBubbleMine]}>
        {!isMe && <Text style={styles.messageUser}>{item.username}</Text>}
        <Text style={styles.messageText}>{item.content}</Text>
        <Text style={styles.messageTime}>{timeAgo(item.created_at)}</Text>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Text style={styles.channelName}>{activeChannel?.name || ''}</Text>
      </View>

      <View style={styles.channelTabs}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={channels}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.channelTabsContent}
          renderItem={({ item }) => (
            <TouchableOpacity testID={`channel-${item.slug}`} style={[styles.channelTab, activeChannel?.id === item.id && styles.channelTabActive]} onPress={() => setActiveChannel(item)}>
              <Text style={[styles.channelTabText, activeChannel?.id === item.id && styles.channelTabTextActive]} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex} keyboardVerticalOffset={100}>
        <FlatList
          ref={flatListRef}
          testID="messages-list"
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="chatbubble-ellipses-outline" size={48} color="#555" /><Text style={styles.emptyText}>Start the conversation</Text></View>}
        />

        <View style={styles.inputBar}>
          <TextInput testID="chat-input" style={styles.input} placeholder="Type a message..." placeholderTextColor="#555" value={newMessage} onChangeText={setNewMessage} multiline maxLength={500} />
          <TouchableOpacity testID="chat-send-btn" style={[styles.sendBtn, (!newMessage.trim() || sending) && styles.sendBtnDisabled]} onPress={sendMessage} disabled={!newMessage.trim() || sending}>
            <Ionicons name="send" size={18} color={newMessage.trim() ? '#000' : '#555'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  channelName: { color: '#A1A1AA', fontSize: 13 },
  channelTabs: { marginBottom: 4 },
  channelTabsContent: { paddingHorizontal: 16, gap: 8 },
  channelTab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1C1C1E' },
  channelTabActive: { backgroundColor: '#00C805' },
  channelTabText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  channelTabTextActive: { color: '#000' },
  messagesList: { paddingHorizontal: 20, paddingVertical: 12, flexGrow: 1 },
  messageBubble: { backgroundColor: '#1C1C1E', borderRadius: 14, borderBottomLeftRadius: 4, padding: 12, marginBottom: 8, maxWidth: '80%', alignSelf: 'flex-start' },
  messageBubbleMine: { backgroundColor: '#0A84FF', alignSelf: 'flex-end', borderBottomLeftRadius: 14, borderBottomRightRadius: 4 },
  messageUser: { color: '#00C805', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  messageText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  messageTime: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1C1C1E', gap: 10 },
  input: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#fff', fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00C805', justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: '#27272A' },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingTop: 100, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
