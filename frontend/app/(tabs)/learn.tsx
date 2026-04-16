import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, TextInput, Modal, ScrollView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius } from '../../theme';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

interface Video {
  id: string;
  title: string;
  description: string;
  url: string;
  embed_url: string;
  thumbnail_url: string;
  platform: string;
  category: string;
  created_by: string;
  created_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'General': colors.textSecondary,
  'Beginner': colors.green,
  'Strategy': colors.blue,
  'Technical Analysis': colors.yellow,
  'Advanced': colors.red,
};

export default function LearnScreen() {
  const { user } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('General');
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.is_admin === true;

  const fetchVideos = useCallback(async () => {
    try {
      const catParam = selectedCategory ? `?category=${encodeURIComponent(selectedCategory)}` : '';
      const [vData, cData] = await Promise.all([
        apiFetch(`/api/videos${catParam}`),
        apiFetch('/api/videos/categories'),
      ]);
      setVideos(vData.videos || []);
      setCategories(cData.categories || ['General', 'Beginner', 'Strategy', 'Technical Analysis', 'Advanced']);
    } catch (e) {
      console.error('Fetch videos error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCategory]);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  const handleAddVideo = async () => {
    if (!newTitle.trim() || !newUrl.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), url: newUrl.trim(), description: newDesc.trim(), category: newCategory }),
      });
      setShowAddModal(false);
      setNewTitle('');
      setNewUrl('');
      setNewDesc('');
      setNewCategory('General');
      fetchVideos();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add video');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      await apiFetch(`/api/videos/${id}`, { method: 'DELETE' });
      fetchVideos();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to delete video');
    }
  };

  const confirmDelete = (video: Video) => {
    Alert.alert('Delete Video', `Remove "${video.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteVideo(video.id) },
    ]);
  };

  // Video Player Modal
  const renderPlayer = () => {
    if (!playingVideo) return null;
    const embedHtml = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;overflow:hidden}
iframe{width:100vw;height:100vh;border:none}</style></head>
<body><iframe src="${playingVideo.embed_url}" allowfullscreen allow="autoplay;encrypted-media;picture-in-picture"></iframe></body></html>`;

    return (
      <Modal visible={true} animationType="slide" presentationStyle="fullScreen">
        <SafeAreaView style={styles.playerSafe}>
          <View style={styles.playerHeader}>
            <TouchableOpacity onPress={() => setPlayingVideo(null)} style={styles.playerCloseBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.playerTitle} numberOfLines={1}>{playingVideo.title}</Text>
            <View style={{ width: 38 }} />
          </View>
          <View style={styles.playerContainer}>
            {Platform.OS === 'web' ? (
              <iframe
                src={playingVideo.embed_url}
                style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#000' } as any}
                allowFullScreen
              />
            ) : WebView ? (
              <WebView
                source={{ html: embedHtml }}
                style={{ flex: 1, backgroundColor: '#000' }}
                javaScriptEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                originWhitelist={['*']}
              />
            ) : (
              <View style={styles.noPlayer}>
                <Text style={{ color: colors.textSecondary }}>Video player not available</Text>
              </View>
            )}
          </View>
          {/* Video Info */}
          <View style={styles.playerInfo}>
            <View style={[styles.catBadge, { backgroundColor: (CATEGORY_COLORS[playingVideo.category] || colors.textSecondary) + '18' }]}>
              <Text style={[styles.catBadgeText, { color: CATEGORY_COLORS[playingVideo.category] || colors.textSecondary }]}>{playingVideo.category}</Text>
            </View>
            {playingVideo.description ? <Text style={styles.playerDesc}>{playingVideo.description}</Text> : null}
            <Text style={styles.playerMeta}>Added by {playingVideo.created_by} \u2022 {timeAgo(playingVideo.created_at)}</Text>
          </View>
        </SafeAreaView>
      </Modal>
    );
  };

  // Add Video Modal
  const renderAddModal = () => (
    <Modal visible={showAddModal} animationType="slide" presentationStyle="formSheet">
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowAddModal(false)}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Add Video</Text>
          <TouchableOpacity onPress={handleAddVideo} disabled={saving || !newTitle.trim() || !newUrl.trim()}>
            <Text style={[styles.modalSave, (!newTitle.trim() || !newUrl.trim()) && { opacity: 0.4 }]}>{saving ? 'Saving...' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Title *</Text>
          <TextInput style={styles.fieldInput} value={newTitle} onChangeText={setNewTitle} placeholder="Video title" placeholderTextColor={colors.textMuted} />

          <Text style={styles.fieldLabel}>YouTube / Vimeo URL *</Text>
          <TextInput style={styles.fieldInput} value={newUrl} onChangeText={setNewUrl} placeholder="https://youtube.com/watch?v=..." placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="url" />

          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput style={[styles.fieldInput, { minHeight: 80 }]} value={newDesc} onChangeText={setNewDesc} placeholder="What this video covers..." placeholderTextColor={colors.textMuted} multiline />

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.catPicker}>
            {['General', 'Beginner', 'Strategy', 'Technical Analysis', 'Advanced'].map(cat => (
              <TouchableOpacity key={cat} style={[styles.catPickerItem, newCategory === cat && styles.catPickerItemActive]} onPress={() => setNewCategory(cat)}>
                <Text style={[styles.catPickerText, newCategory === cat && styles.catPickerTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderVideoCard = ({ item }: { item: Video }) => {
    const catColor = CATEGORY_COLORS[item.category] || colors.textSecondary;
    return (
      <TouchableOpacity style={styles.videoCard} onPress={() => setPlayingVideo(item)} activeOpacity={0.7}>
        {/* Thumbnail */}
        <View style={styles.thumbnailWrap}>
          {item.thumbnail_url ? (
            <View style={styles.thumbnail}>
              <View style={styles.thumbnailInner}>
                <Ionicons name="play-circle" size={40} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Ionicons name="videocam" size={32} color={colors.textMuted} />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={20} color={colors.textPrimary} />
              </View>
            </View>
          )}
        </View>
        {/* Info */}
        <View style={styles.videoInfo}>
          <Text style={styles.videoTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.videoMeta}>
            <View style={[styles.catBadgeSmall, { backgroundColor: catColor + '18' }]}>
              <Text style={[styles.catBadgeSmallText, { color: catColor }]}>{item.category}</Text>
            </View>
            <Text style={styles.videoTime}>{timeAgo(item.created_at)}</Text>
          </View>
          {item.description ? <Text style={styles.videoDesc} numberOfLines={1}>{item.description}</Text> : null}
        </View>
        {/* Admin delete */}
        {isAdmin && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDelete(item)}>
            <Ionicons name="trash-outline" size={16} color={colors.red} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {renderPlayer()}
      {renderAddModal()}

      {/* Header */}
      <View style={styles.header}>
        <View>
          <View style={styles.headerTitleRow}>
            <Text style={styles.sectionPrefix}>⟩</Text>
            <Text style={styles.title}>Onboard</Text>
          </View>
          <Text style={styles.subtitle}>{videos.length} video{videos.length !== 1 ? 's' : ''} available</Text>
        </View>
        {isAdmin && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
            <Ionicons name="add" size={20} color={colors.green} />
            <Text style={styles.addBtnText}>Add Video</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll} contentContainerStyle={styles.catScrollContent}>
        <TouchableOpacity style={[styles.catPill, !selectedCategory && styles.catPillActive]} onPress={() => setSelectedCategory('')}>
          <Text style={[styles.catPillText, !selectedCategory && styles.catPillTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map(cat => (
          <TouchableOpacity key={cat} style={[styles.catPill, selectedCategory === cat && styles.catPillActive]} onPress={() => setSelectedCategory(cat === selectedCategory ? '' : cat)}>
            <Text style={[styles.catPillText, selectedCategory === cat && styles.catPillTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={videos}
        keyExtractor={item => item.id}
        renderItem={renderVideoCard}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchVideos(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="play-circle-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No Videos Yet</Text>
            <Text style={styles.emptyText}>{isAdmin ? 'Tap \"Add Video\" to start building your course library.' : 'Teaching videos will appear here when added by your instructor.'}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 11, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, gap: 4, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  addBtnText: { color: colors.green, fontSize: 12, fontWeight: '700' },

  // Category Filter
  catScroll: { maxHeight: 42, marginBottom: spacing.md },
  catScrollContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  catPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  catPillActive: { backgroundColor: colors.green, borderColor: colors.green },
  catPillText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  catPillTextActive: { color: '#000' },

  // Video Cards
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 20 },
  videoCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  thumbnailWrap: { width: '100%', height: 180, backgroundColor: '#0A0A0A' },
  thumbnail: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  thumbnailInner: { justifyContent: 'center', alignItems: 'center' },
  thumbnailPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceElevated },
  playOverlay: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,200,5,0.8)', justifyContent: 'center', alignItems: 'center' },
  videoInfo: { padding: spacing.lg },
  videoTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 21, marginBottom: spacing.sm },
  videoMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  catBadgeSmall: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  catBadgeSmallText: { fontSize: 10, fontWeight: '700' },
  videoTime: { color: colors.textMuted, fontSize: 10 },
  videoDesc: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  deleteBtn: { position: 'absolute', top: spacing.md, right: spacing.md, width: 32, height: 32, borderRadius: 8, backgroundColor: colors.redBg, justifyContent: 'center', alignItems: 'center' },

  // Empty State
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: spacing.md },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  // Player Modal
  playerSafe: { flex: 1, backgroundColor: colors.bg },
  playerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  playerCloseBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  playerTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center', marginHorizontal: spacing.md },
  playerContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  noPlayer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  playerInfo: { padding: spacing.xl, gap: spacing.sm },
  catBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  catBadgeText: { fontSize: 11, fontWeight: '700' },
  playerDesc: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  playerMeta: { color: colors.textMuted, fontSize: 11 },

  // Add Modal
  modalSafe: { flex: 1, backgroundColor: colors.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalCancel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  modalSave: { color: colors.green, fontSize: 15, fontWeight: '700' },
  modalContent: { padding: spacing.xl },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: spacing.lg, letterSpacing: 0.3 },
  fieldInput: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: colors.textPrimary, fontSize: 15 },
  catPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  catPickerItem: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  catPickerItemActive: { backgroundColor: colors.green, borderColor: colors.green },
  catPickerText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  catPickerTextActive: { color: '#000' },
});
