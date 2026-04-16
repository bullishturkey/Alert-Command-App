import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius } from '../../theme';

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
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.sectionPrefix}>⟩</Text>
          <Text style={styles.title}>Community</Text>
        </View>
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyText}>Start the conversation</Text>
            </View>
          }
        />

        <View style={styles.inputBar}>
          <TextInput testID="chat-input" style={styles.input} placeholder="Type a message..." placeholderTextColor={colors.textMuted} value={newMessage} onChangeText={setNewMessage} multiline maxLength={500} />
          <TouchableOpacity testID="chat-send-btn" style={[styles.sendBtn, (!newMessage.trim() || sending) && styles.sendBtnDisabled]} onPress={sendMessage} disabled={!newMessage.trim() || sending}>
            <Ionicons name="send" size={16} color={newMessage.trim() ? '#000' : colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  channelName: { color: colors.textTertiary, fontSize: 12, fontWeight: '500' },
  channelTabs: { marginBottom: 4 },
  channelTabsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  channelTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  channelTabActive: { backgroundColor: colors.green, borderColor: colors.green },
  channelTabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  channelTabTextActive: { color: '#000' },
  messagesList: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, flexGrow: 1 },
  messageBubble: { backgroundColor: colors.surface, borderRadius: radius.md, borderBottomLeftRadius: 4, padding: spacing.md, marginBottom: spacing.sm, maxWidth: '80%', alignSelf: 'flex-start' as const, borderWidth: 1, borderColor: colors.border },
  messageBubbleMine: { backgroundColor: colors.greenDim, alignSelf: 'flex-end' as const, borderBottomLeftRadius: radius.md, borderBottomRightRadius: 4, borderColor: 'rgba(0,200,5,0.2)' },
  messageUser: { color: colors.green, fontSize: 11, fontWeight: '700', marginBottom: 3 },
  messageText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  messageTime: { color: 'rgba(255,255,255,0.3)', fontSize: 9, marginTop: 4, alignSelf: 'flex-end' as const },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: 10, color: colors.textPrimary, fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { backgroundColor: colors.surfaceHover },
  empty: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingTop: 100, gap: spacing.md },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyText: { color: colors.textTertiary, fontSize: 14 },
});
