import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, formatPrice } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

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

  const fetchNdx = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/ndx');
      setNdx(data);
    } catch (e) {
      console.error('NDX fetch error:', e);
    }
  }, []);

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
  const ndxColor = ndxPositive ? colors.green : colors.red;

  const renderStockCard = ({ item }: { item: Quote }) => {
    const isPositive = item.changePercent >= 0;
    const color = isPositive ? colors.green : colors.red;
    return (
      <TouchableOpacity testID={`stock-card-${item.symbol}`} style={styles.card} onPress={() => router.push(`/stock/${item.symbol}`)} activeOpacity={0.7}>
        <View style={styles.cardLeft}>
          <View style={[styles.symbolBadge, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
            <Text style={[styles.symbolText, { color }]}>{item.symbol}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardSector}>{(item as any).sector || ''}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>${formatPrice(item.price)}</Text>
          <View style={[styles.changeBadge, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={10} color={color} />
            <Text style={[styles.changeText, { color }]}>{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.green} /></View>;
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
            <TouchableOpacity testID="admin-btn" style={styles.iconBtn} onPress={() => router.push('/admin')}>
              <Ionicons name="shield-checkmark" size={18} color={colors.blue} />
            </TouchableOpacity>
          )}
          <TouchableOpacity testID="logout-btn" style={styles.iconBtn} onPress={logout}>
            <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Live NDX Hero */}
      {ndx && (
        <TouchableOpacity testID="ndx-ticker" style={[styles.ndxTicker, ndxPositive ? styles.ndxTickerBullish : styles.ndxTickerBearish]} onPress={() => router.push('/stock/NDX')} activeOpacity={0.8}>
          <View style={styles.ndxTop}>
            <View style={styles.ndxLiveBadge}>
              <View style={styles.ndxLiveDot} />
              <Text style={styles.ndxLiveText}>LIVE</Text>
            </View>
            <Text style={styles.ndxSentiment}>{ndxPositive ? 'BULLISH' : 'BEARISH'}</Text>
          </View>
          <View style={styles.ndxMain}>
            <View>
              <Text style={styles.ndxLabel}>NASDAQ 100</Text>
              <Text style={styles.ndxSymbol}>NDX</Text>
            </View>
            <View style={styles.ndxPriceBlock}>
              <Text style={styles.ndxPrice}>${formatPrice(ndx.price)}</Text>
              <View style={[styles.ndxChangeBadge, { backgroundColor: ndxPositive ? colors.greenBgStrong : colors.redBgStrong }]}>
                <Ionicons name={ndxPositive ? 'caret-up' : 'caret-down'} size={12} color={ndxColor} />
                <Text style={[styles.ndxChangeText, { color: ndxColor }]}>{ndxPositive ? '+' : ''}{ndx.changePercent.toFixed(2)}%</Text>
                <Text style={[styles.ndxChangeAbs, { color: ndxColor }]}>({ndxPositive ? '+' : ''}${ndx.change.toFixed(2)})</Text>
              </View>
            </View>
          </View>

          {/* NDX Stats */}
          <View style={styles.ndxStats}>
            <View style={styles.ndxStat}>
              <Text style={styles.ndxStatLabel}>Open</Text>
              <Text style={styles.ndxStatValue}>${formatPrice(ndx.open)}</Text>
            </View>
            <View style={styles.ndxStatDivider} />
            <View style={styles.ndxStat}>
              <Text style={styles.ndxStatLabel}>High</Text>
              <Text style={[styles.ndxStatValue, { color: colors.green }]}>${formatPrice(ndx.high)}</Text>
            </View>
            <View style={styles.ndxStatDivider} />
            <View style={styles.ndxStat}>
              <Text style={styles.ndxStatLabel}>Low</Text>
              <Text style={[styles.ndxStatValue, { color: colors.red }]}>${formatPrice(ndx.low)}</Text>
            </View>
            <View style={styles.ndxStatDivider} />
            <View style={styles.ndxStat}>
              <Text style={styles.ndxStatLabel}>Prev</Text>
              <Text style={styles.ndxStatValue}>${formatPrice(ndx.previousClose)}</Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {/* Section Title */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionPrefix}>⟩</Text>
        <Text style={styles.sectionTitle}>Key Influence Stocks</Text>
      </View>

      <FlatList
        testID="quotes-list"
        data={quotes}
        keyExtractor={(item) => item.symbol}
        renderItem={renderStockCard}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerLogo: { width: 36, height: 36, borderRadius: 10 },
  greeting: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.3 },
  subtitle: { fontSize: 12, color: colors.textTertiary, marginTop: 1 },
  headerRight: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },

  // NDX Hero
  ndxTicker: { marginHorizontal: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, marginBottom: spacing.lg },
  ndxTickerBullish: { borderColor: 'rgba(0,200,5,0.2)' },
  ndxTickerBearish: { borderColor: 'rgba(255,68,68,0.2)' },
  ndxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  ndxLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  ndxLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  ndxLiveText: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  ndxSentiment: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ndxMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.lg },
  ndxLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  ndxSymbol: { color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: 2 },
  ndxPriceBlock: { alignItems: 'flex-end' },
  ndxPrice: { color: colors.textPrimary, fontSize: 28, fontWeight: '800' },
  ndxChangeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, marginTop: 4, gap: 4 },
  ndxChangeText: { fontSize: 13, fontWeight: '700' },
  ndxChangeAbs: { fontSize: 11, fontWeight: '500' },

  // NDX Stats
  ndxStats: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle },
  ndxStat: { flex: 1, alignItems: 'center' },
  ndxStatLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 2, letterSpacing: 0.3 },
  ndxStatValue: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  ndxStatDivider: { width: 1, backgroundColor: colors.borderSubtle },

  // Section Header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.md, gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 18, fontWeight: '800' },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  // Stock Cards
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 20 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.md },
  symbolBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, marginRight: spacing.md },
  symbolText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  cardInfo: { flex: 1 },
  cardName: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  cardSector: { color: colors.textMuted, fontSize: 10, fontWeight: '500', marginTop: 1 },
  cardRight: { alignItems: 'flex-end' },
  cardPrice: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginTop: 4, gap: 2 },
  changeText: { fontSize: 11, fontWeight: '700' },
});
