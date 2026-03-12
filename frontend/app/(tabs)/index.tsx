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
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [ndx, setNdx] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fast NDX polling (every 5s)
  const fetchNdx = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/ndx');
      setNdx(data);
    } catch (e) {
      console.error('NDX fetch error:', e);
    }
  }, []);

  // All quotes polling (every 30s)
  const fetchQuotes = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/quotes');
      const all = data.quotes || [];
      setQuotes(all.filter((q: Quote) => q.symbol !== 'NDX'));
      const ndxQuote = all.find((q: Quote) => q.symbol === 'NDX');
      if (ndxQuote) setNdx(ndxQuote);
    } catch (e) {
      console.error('Fetch quotes error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchQuotes();
    fetchNdx();
    const ndxInterval = setInterval(fetchNdx, 5000);
    const quotesInterval = setInterval(fetchQuotes, 30000);
    return () => { clearInterval(ndxInterval); clearInterval(quotesInterval); };
  }, [fetchQuotes, fetchNdx]);

  const onRefresh = () => { setRefreshing(true); fetchQuotes(); fetchNdx(); };

  const ndxPositive = ndx ? ndx.changePercent >= 0 : true;
  const ndxColor = ndxPositive ? '#00C805' : '#FF5000';

  const renderStockCard = ({ item }: { item: Quote }) => {
    const isPositive = item.changePercent >= 0;
    const color = isPositive ? '#00C805' : '#FF5000';
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
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={12} color={color} />
            <Text style={[styles.changeText, { color }]}>{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
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

      {/* Live NDX Ticker */}
      {ndx && (
        <TouchableOpacity testID="ndx-ticker" style={styles.ndxTicker} onPress={() => router.push('/stock/NDX')} activeOpacity={0.8}>
          <View style={styles.ndxLeft}>
            <View style={styles.ndxLiveBadge}>
              <View style={styles.ndxLiveDot} />
              <Text style={styles.ndxLiveText}>LIVE</Text>
            </View>
            <Text style={styles.ndxLabel}>NDX</Text>
            <Text style={styles.ndxName}>Nasdaq 100</Text>
          </View>
          <View style={styles.ndxRight}>
            <Text style={styles.ndxPrice}>${formatPrice(ndx.price)}</Text>
            <View style={[styles.ndxChangeBadge, { backgroundColor: ndxPositive ? 'rgba(0,200,5,0.15)' : 'rgba(255,80,0,0.15)' }]}>
              <Ionicons name={ndxPositive ? 'caret-up' : 'caret-down'} size={14} color={ndxColor} />
              <Text style={[styles.ndxChangeText, { color: ndxColor }]}>{ndxPositive ? '+' : ''}{ndx.changePercent.toFixed(2)}%</Text>
              <Text style={[styles.ndxChangeAbs, { color: ndxColor }]}>(${Math.abs(ndx.change).toFixed(2)})</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* NDX Stats Row */}
      {ndx && (
        <View style={styles.ndxStats}>
          <View style={styles.ndxStat}>
            <Text style={styles.ndxStatLabel}>Open</Text>
            <Text style={styles.ndxStatValue}>${formatPrice(ndx.open)}</Text>
          </View>
          <View style={styles.ndxStatDivider} />
          <View style={styles.ndxStat}>
            <Text style={styles.ndxStatLabel}>High</Text>
            <Text style={[styles.ndxStatValue, { color: '#00C805' }]}>${formatPrice(ndx.high)}</Text>
          </View>
          <View style={styles.ndxStatDivider} />
          <View style={styles.ndxStat}>
            <Text style={styles.ndxStatLabel}>Low</Text>
            <Text style={[styles.ndxStatValue, { color: '#FF5000' }]}>${formatPrice(ndx.low)}</Text>
          </View>
          <View style={styles.ndxStatDivider} />
          <View style={styles.ndxStat}>
            <Text style={styles.ndxStatLabel}>Prev</Text>
            <Text style={styles.ndxStatValue}>${formatPrice(ndx.previousClose)}</Text>
          </View>
        </View>
      )}

      {/* Influence Stocks */}
      <Text style={styles.sectionTitle}>Key Influence Stocks</Text>

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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLogo: { width: 40, height: 40, borderRadius: 10 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, color: '#A1A1AA', marginTop: 1 },
  headerRight: { flexDirection: 'row', gap: 12 },
  adminBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,132,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },

  // NDX Live Ticker
  ndxTicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#27272A' },
  ndxLeft: { gap: 2 },
  ndxLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  ndxLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00C805' },
  ndxLiveText: { color: '#00C805', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  ndxLabel: { color: '#fff', fontSize: 20, fontWeight: '800' },
  ndxName: { color: '#555', fontSize: 12 },
  ndxRight: { alignItems: 'flex-end' },
  ndxPrice: { color: '#fff', fontSize: 24, fontWeight: '800' },
  ndxChangeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 4, gap: 4 },
  ndxChangeText: { fontSize: 14, fontWeight: '700' },
  ndxChangeAbs: { fontSize: 12, fontWeight: '500' },

  // NDX Stats
  ndxStats: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#0A0A0A', borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 12 },
  ndxStat: { flex: 1, alignItems: 'center' },
  ndxStatLabel: { color: '#555', fontSize: 11, marginBottom: 2 },
  ndxStatValue: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  ndxStatDivider: { width: 1, backgroundColor: '#1C1C1E' },

  sectionTitle: { color: '#A1A1AA', fontSize: 13, fontWeight: '600', paddingHorizontal: 20, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 8 },
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
