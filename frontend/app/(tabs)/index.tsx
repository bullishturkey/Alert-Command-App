import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, formatPrice, formatNumber } from '../../utils/api';

interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  sentiment: string;
  sparkline: number[];
}

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchQuotes = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/quotes');
      setQuotes(data.quotes || []);
    } catch (e) {
      console.error('Fetch quotes error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 30000);
    return () => clearInterval(interval);
  }, [fetchQuotes]);

  const onRefresh = () => { setRefreshing(true); fetchQuotes(); };

  const renderStockCard = ({ item }: { item: Quote }) => {
    const isPositive = item.changePercent >= 0;
    const color = isPositive ? '#00C805' : '#FF5000';
    const arrow = isPositive ? 'caret-up' : 'caret-down';
    return (
      <TouchableOpacity testID={`stock-card-${item.symbol}`} style={styles.card} onPress={() => router.push(`/stock/${item.symbol}`)} activeOpacity={0.7}>
        <View style={styles.cardLeft}>
          <View style={[styles.symbolBadge, { backgroundColor: isPositive ? 'rgba(0,200,5,0.12)' : 'rgba(255,80,0,0.12)' }]}>
            <Text style={[styles.symbolText, { color }]}>{item.symbol}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardVolume}>Vol: {formatNumber(item.volume)}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>${formatPrice(item.price)}</Text>
          <View style={[styles.changeBadge, { backgroundColor: isPositive ? 'rgba(0,200,5,0.15)' : 'rgba(255,80,0,0.15)' }]}>
            <Ionicons name={arrow} size={12} color={color} />
            <Text style={[styles.changeText, { color }]}>{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const marketSentiment = quotes.length > 0
    ? quotes.filter(q => q.changePercent >= 0).length / quotes.length
    : 0.5;
  const sentimentLabel = marketSentiment > 0.6 ? 'Bullish' : marketSentiment < 0.4 ? 'Bearish' : 'Mixed';
  const sentimentColor = marketSentiment > 0.6 ? '#00C805' : marketSentiment < 0.4 ? '#FF5000' : '#FFD60A';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00C805" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/ndx-logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View>
            <Text style={styles.greeting}>NDX Command</Text>
            <Text style={styles.subtitle}>Welcome, {user?.username}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {user?.is_admin && (
            <TouchableOpacity testID="admin-btn" style={styles.adminBtn} onPress={() => router.push('/admin')}>
              <Ionicons name="shield-checkmark" size={20} color="#0A84FF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity testID="logout-btn" style={styles.logoutBtn} onPress={logout}>
            <Ionicons name="log-out-outline" size={20} color="#A1A1AA" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.sentimentBar}>
        <View style={styles.sentimentLeft}>
          <View style={[styles.sentimentDot, { backgroundColor: sentimentColor }]} />
          <Text style={styles.sentimentLabel}>Market Sentiment</Text>
        </View>
        <Text style={[styles.sentimentValue, { color: sentimentColor }]}>{sentimentLabel}</Text>
      </View>

      <FlatList
        testID="quotes-list"
        data={quotes}
        keyExtractor={(item) => item.symbol}
        renderItem={renderStockCard}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00C805" />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  loadingContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLogo: { width: 40, height: 40, borderRadius: 10 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: '#A1A1AA', marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 12 },
  adminBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,132,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },
  sentimentBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, backgroundColor: '#1C1C1E', borderRadius: 10, padding: 14, marginBottom: 12 },
  sentimentLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentimentDot: { width: 8, height: 8, borderRadius: 4 },
  sentimentLabel: { color: '#A1A1AA', fontSize: 13, fontWeight: '500' },
  sentimentValue: { fontSize: 14, fontWeight: '700' },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 10 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  symbolBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginRight: 12 },
  symbolText: { fontSize: 14, fontWeight: '700' },
  cardInfo: { flex: 1 },
  cardName: { color: '#fff', fontSize: 14, fontWeight: '500' },
  cardVolume: { color: '#555', fontSize: 11, marginTop: 2 },
  cardRight: { alignItems: 'flex-end' },
  cardPrice: { color: '#fff', fontSize: 17, fontWeight: '700' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 4, gap: 2 },
  changeText: { fontSize: 12, fontWeight: '700' },
});
