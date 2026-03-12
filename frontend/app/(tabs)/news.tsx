import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';

interface Article {
  id: string;
  headline: string;
  source: string;
  summary: string;
  url: string;
  sentiment: string;
  tickers: string[];
  category: string;
  timestamp: string;
}

const SENTIMENT_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  bullish: { label: 'Bullish', color: '#00C805', bg: 'rgba(0,200,5,0.12)', icon: 'arrow-up' },
  bearish: { label: 'Bearish', color: '#FF5000', bg: 'rgba(255,80,0,0.12)', icon: 'arrow-down' },
  neutral: { label: 'Neutral', color: '#A1A1AA', bg: 'rgba(161,161,170,0.12)', icon: 'remove' },
};

const CATEGORIES = ['All', 'macro', 'tech', 'earnings', 'market'];

export default function NewsScreen() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('All');

  const fetchNews = useCallback(async () => {
    try {
      const data = await apiFetch('/api/news');
      setArticles(data.articles || []);
    } catch (e) {
      console.error('Fetch news error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const filtered = filter === 'All' ? articles : articles.filter(a => a.category === filter);

  const renderArticle = ({ item }: { item: Article }) => {
    const sent = SENTIMENT_CONFIG[item.sentiment] || SENTIMENT_CONFIG.neutral;
    return (
      <TouchableOpacity testID={`news-item-${item.id}`} style={styles.newsCard} onPress={() => item.url && Linking.openURL(item.url)} activeOpacity={0.7}>
        <View style={styles.newsHeader}>
          <Text style={styles.newsSource}>{item.source}</Text>
          <View style={[styles.sentimentBadge, { backgroundColor: sent.bg }]}>
            <Ionicons name={sent.icon as any} size={10} color={sent.color} />
            <Text style={[styles.sentimentText, { color: sent.color }]}>{sent.label}</Text>
          </View>
        </View>
        <Text style={styles.newsHeadline} numberOfLines={2}>{item.headline}</Text>
        <Text style={styles.newsSummary} numberOfLines={2}>{item.summary}</Text>
        <View style={styles.newsFooter}>
          <View style={styles.tickerRow}>
            {item.tickers?.map(t => (
              <View key={t} style={styles.tickerChip}><Text style={styles.tickerChipText}>{t}</Text></View>
            ))}
          </View>
          <Text style={styles.newsTime}>{timeAgo(item.timestamp)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Market News</Text>
        <Ionicons name="globe-outline" size={22} color="#A1A1AA" />
      </View>

      <View style={styles.filterRow}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity testID={`news-filter-${cat}`} key={cat} style={[styles.filterPill, filter === cat && styles.filterPillActive]} onPress={() => setFilter(cat)}>
            <Text style={[styles.filterText, filter === cat && styles.filterTextActive]}>{cat === 'All' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        testID="news-list"
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderArticle}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNews(); }} tintColor="#00C805" />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="newspaper-outline" size={48} color="#555" /><Text style={styles.emptyText}>No news available</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1C1C1E' },
  filterPillActive: { backgroundColor: '#00C805' },
  filterText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: '#000' },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  newsCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 10 },
  newsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  newsSource: { color: '#555', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sentimentBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, gap: 4 },
  sentimentText: { fontSize: 11, fontWeight: '700' },
  newsHeadline: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22, marginBottom: 6 },
  newsSummary: { color: '#A1A1AA', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  newsFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tickerRow: { flexDirection: 'row', gap: 6 },
  tickerChip: { backgroundColor: 'rgba(10,132,255,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tickerChipText: { color: '#0A84FF', fontSize: 11, fontWeight: '700' },
  newsTime: { color: '#555', fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
