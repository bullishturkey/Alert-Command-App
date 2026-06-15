import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch, formatPrice } from '../../utils/api';
import { readCache, writeCache, CACHE_KEYS, CACHE_TTL_MS } from '../../utils/deviceCache';
import { colors, spacing, radius } from '../../theme';
import { useAppForeground } from '../../hooks/useAppForeground';

interface NdxStock {
  symbol: string;
  name: string;
  weight: number;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  impact_pts: number;
}

interface NdxImpact {
  ndx_price: number;
  ndx_change_pts: number;
  ndx_change_pct: number;
  total_explained_pts: number;
  stocks: NdxStock[];
}

interface Quote {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  volume: number; sentiment: string; high: number; low: number; open: number; previousClose: number;
}

// Intraday range bar
function RangeBar({ low, high, current, color }: { low: number; high: number; current: number; color: string }) {
  const range = high - low;
  const pct = range > 0 ? Math.min(Math.max((current - low) / range, 0), 1) : 0.5;
  return (
    <View style={rb.track}>
      <View style={[rb.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
      <View style={[rb.dot, { left: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}
const rb = StyleSheet.create({
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginVertical: 6, position: 'relative' },
  fill: { height: 3, borderRadius: 2, position: 'absolute', left: 0, top: 0 },
  dot: { width: 7, height: 7, borderRadius: 4, position: 'absolute', top: -2, marginLeft: -3.5, borderWidth: 1.5, borderColor: '#000' },
});

// Weight bar — shows relative weight vs max weight in the list
function WeightBar({ weight, maxWeight, color }: { weight: number; maxWeight: number; color: string }) {
  const pct = maxWeight > 0 ? weight / maxWeight : 0;
  return (
    <View style={wb.track}>
      <View style={[wb.fill, { width: `${pct * 100}%` as any, backgroundColor: color, opacity: 0.35 }]} />
    </View>
  );
}
const wb = StyleSheet.create({
  track: { height: 2, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, marginTop: 5 },
  fill: { height: 2, borderRadius: 1, position: 'absolute', left: 0, top: 0 },
});

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [ndx, setNdx] = useState<Quote | null>(null);
  const [impact, setImpact] = useState<NdxImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const fetchNdx = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/ndx');
      setNdx(data);
      setIsOffline(false);
      writeCache(CACHE_KEYS.NDX_QUOTE, data);
    } catch (e) { console.error('NDX fetch error:', e); setIsOffline(true); }
  }, []);

  const fetchImpact = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/ndx-impact');
      setImpact(data);
      setIsOffline(false);
    } catch (e) { console.error('Impact fetch error:', e); setIsOffline(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    // Load cached NDX immediately
    (async () => {
      const cachedNdx = await readCache<Quote>(CACHE_KEYS.NDX_QUOTE, CACHE_TTL_MS.NDX_QUOTE);
      if (cachedNdx) setNdx(cachedNdx.data);
    })();
    fetchNdx();
    fetchImpact();
    const ndxInterval = setInterval(fetchNdx, 5000);
    const impactInterval = setInterval(fetchImpact, 30000);
    return () => { clearInterval(ndxInterval); clearInterval(impactInterval); };
  }, [fetchNdx, fetchImpact]);

  useAppForeground(() => { fetchNdx(); fetchImpact(); });

  const onRefresh = () => { setRefreshing(true); fetchNdx(); fetchImpact(); };

  const ndxPositive = ndx ? ndx.changePercent >= 0 : true;
  const ndxColor = ndxPositive ? colors.green : colors.red;

  const maxWeight = impact ? Math.max(...impact.stocks.map(s => s.weight)) : 1;

  const explainedAbs = impact ? Math.abs(impact.total_explained_pts) : 0;
  const ndxAbs = impact ? Math.abs(impact.ndx_change_pts) : 0;
  const explainedPct = ndxAbs > 0 ? Math.min((explainedAbs / ndxAbs) * 100, 100) : 0;

  const renderStockRow = ({ item, index }: { item: NdxStock; index: number }) => {
    const isPositive = item.changePercent >= 0;
    const color = isPositive ? colors.green : colors.red;
    const impactPositive = item.impact_pts >= 0;
    const impactColor = impactPositive ? colors.green : colors.red;
    const impactSign = impactPositive ? '+' : '';

    return (
      <View style={styles.stockRow}>
        {/* Rank */}
        <Text style={styles.rank}>#{index + 1}</Text>

        {/* Symbol + Name + Weight bar */}
        <View style={styles.stockLeft}>
          <View style={styles.stockTopLine}>
            <Text style={[styles.stockSymbol, { color }]}>{item.symbol}</Text>
            <Text style={styles.stockWeight}>{item.weight.toFixed(2)}% of NDX</Text>
          </View>
          <Text style={styles.stockName} numberOfLines={1}>{item.name}</Text>
          <WeightBar weight={item.weight} maxWeight={maxWeight} color={color} />
        </View>

        {/* Move + Impact */}
        <View style={styles.stockRight}>
          <View style={[styles.changePill, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={9} color={color} />
            <Text style={[styles.changePillText, { color }]}>
              {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
            </Text>
          </View>
          <View style={styles.impactRow}>
            <Text style={styles.impactLabel}>Impact </Text>
            <Text style={[styles.impactValue, { color: impactColor }]}>
              {impactSign}{item.impact_pts.toFixed(1)} pts
            </Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={colors.green} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/ndx-logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View>
            <Text style={styles.greeting}>Alerts Command</Text>
            <Text style={styles.subtitle}>Welcome, {user?.username}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {user?.is_admin && (
            <TouchableOpacity testID="admin-btn" style={styles.iconBtn} onPress={() => router.push('/admin')}>
              <Ionicons name="shield-checkmark" size={18} color={colors.blue} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={impact?.stocks || []}
        keyExtractor={item => item.symbol}
        renderItem={renderStockRow}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Live NDX Hero */}
            {ndx && (
              <View style={[styles.ndxTicker, ndxPositive ? styles.ndxTickerBullish : styles.ndxTickerBearish]}>
                <View style={styles.ndxTop}>
                  <View style={styles.ndxLiveBadge}>
                    <View style={styles.ndxLiveDot} />
                    <Text style={styles.ndxLiveText}>LIVE</Text>
                  </View>
                  <Text style={styles.ndxSentiment}>{ndxPositive ? 'BULLISH' : 'BEARISH'}</Text>
                </View>
                <View style={styles.ndxMain}>
                  <View style={styles.ndxMainLeft}>
                    <Text style={styles.ndxLabel}>NASDAQ 100</Text>
                    <Text style={styles.ndxSymbol}>NDX</Text>
                  </View>
                  <View style={styles.ndxPriceBlock}>
                    <Text style={styles.ndxPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      ${formatPrice(ndx.price)}
                    </Text>
                    <View style={[styles.ndxChangeBadge, { backgroundColor: ndxPositive ? colors.greenBgStrong : colors.redBgStrong }]}>
                      <Ionicons name={ndxPositive ? 'caret-up' : 'caret-down'} size={11} color={ndxColor} />
                      <Text style={[styles.ndxChangeText, { color: ndxColor }]}>
                        {ndxPositive ? '+' : ''}{ndx.changePercent.toFixed(2)}%
                      </Text>
                      <Text style={[styles.ndxChangeAbs, { color: ndxColor }]}>
                        {ndxPositive ? '+' : ''}${Math.abs(ndx.change).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
                <RangeBar low={ndx.low} high={ndx.high} current={ndx.price} color={ndxColor} />
                <View style={styles.ndxStats}>
                  <View style={styles.ndxStat}><Text style={styles.ndxStatLabel}>Open</Text><Text style={styles.ndxStatValue}>${Math.round(ndx.open).toLocaleString()}</Text></View>
                  <View style={styles.ndxStatDivider} />
                  <View style={styles.ndxStat}><Text style={styles.ndxStatLabel}>High</Text><Text style={[styles.ndxStatValue, { color: colors.green }]}>${Math.round(ndx.high).toLocaleString()}</Text></View>
                  <View style={styles.ndxStatDivider} />
                  <View style={styles.ndxStat}><Text style={styles.ndxStatLabel}>Low</Text><Text style={[styles.ndxStatValue, { color: colors.red }]}>${Math.round(ndx.low).toLocaleString()}</Text></View>
                  <View style={styles.ndxStatDivider} />
                  <View style={styles.ndxStat}><Text style={styles.ndxStatLabel}>Prev</Text><Text style={styles.ndxStatValue}>${Math.round(ndx.previousClose).toLocaleString()}</Text></View>
                </View>
              </View>
            )}

            {/* Impact Summary Banner */}
            {impact && (
              <View style={styles.impactBanner}>
                <View style={styles.impactBannerTop}>
                  <Text style={styles.impactBannerTitle}>⟩ NDX Impact — Top 15 Weighted</Text>
                  <Text style={styles.impactBannerSub}>
                    These stocks account for{' '}
                    <Text style={{ color: impact.total_explained_pts >= 0 ? colors.green : colors.red, fontWeight: '800' }}>
                      {impact.total_explained_pts >= 0 ? '+' : ''}{impact.total_explained_pts.toFixed(1)} pts
                    </Text>
                    {' '}of today's{' '}
                    <Text style={{ color: impact.ndx_change_pts >= 0 ? colors.green : colors.red, fontWeight: '700' }}>
                      {impact.ndx_change_pts >= 0 ? '+' : ''}{impact.ndx_change_pts.toFixed(1)} pt
                    </Text>
                    {' '}NDX move
                  </Text>
                </View>
                {/* Explained % bar */}
                <View style={styles.explainedBarTrack}>
                  <View style={[
                    styles.explainedBarFill,
                    {
                      width: `${explainedPct}%` as any,
                      backgroundColor: impact.ndx_change_pts >= 0 ? colors.green : colors.red,
                    }
                  ]} />
                </View>
                <Text style={styles.explainedLabel}>{explainedPct.toFixed(0)}% of move explained by these 15 stocks</Text>
              </View>
            )}
          </>
        }
        ListFooterComponent={
          <View style={styles.footerDisclaimer}>
            <Ionicons name="information-circle-outline" size={12} color={colors.textMuted} style={{ marginTop: 1 }} />
            <Text style={styles.footerDisclaimerText}>
              Not affiliated with Nasdaq, Inc. Weights approximate. For informational purposes only — not financial advice.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerLogo: { width: 36, height: 36, borderRadius: 10 },
  greeting: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.3 },
  subtitle: { fontSize: 12, color: colors.textTertiary, marginTop: 1 },
  headerRight: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 20 },
  // NDX Hero
  ndxTicker: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, marginBottom: spacing.lg },
  ndxTickerBullish: { borderColor: 'rgba(0,200,5,0.2)' },
  ndxTickerBearish: { borderColor: 'rgba(255,68,68,0.2)' },
  ndxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  ndxLiveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  ndxLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  ndxLiveText: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  ndxSentiment: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ndxMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.sm, gap: spacing.md },
  ndxMainLeft: { flexShrink: 1 },
  ndxLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  ndxSymbol: { color: colors.textPrimary, fontSize: 24, fontWeight: '800', marginTop: 2 },
  ndxPriceBlock: { alignItems: 'flex-end', flexShrink: 0 },
  ndxPrice: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  ndxChangeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, marginTop: 6, gap: 5 },
  ndxChangeText: { fontSize: 12, fontWeight: '700' },
  ndxChangeAbs: { fontSize: 11, fontWeight: '600', opacity: 0.85 },
  ndxStats: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle, marginTop: 4 },
  ndxStat: { flex: 1, alignItems: 'center' },
  ndxStatLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 2, letterSpacing: 0.3 },
  ndxStatValue: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  ndxStatDivider: { width: 1, backgroundColor: colors.borderSubtle },
  // Impact Banner
  impactBanner: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  impactBannerTop: { marginBottom: spacing.md },
  impactBannerTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  impactBannerSub: { color: colors.textTertiary, fontSize: 13, fontWeight: '500', lineHeight: 19 },
  explainedBarTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: 6, overflow: 'hidden' },
  explainedBarFill: { height: 4, borderRadius: 2, position: 'absolute', left: 0, top: 0, opacity: 0.7 },
  explainedLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  // Stock rows
  stockRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  rank: { color: colors.textMuted, fontSize: 11, fontWeight: '700', width: 20, textAlign: 'center' },
  stockLeft: { flex: 1 },
  stockTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stockSymbol: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  stockWeight: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  stockName: { color: colors.textTertiary, fontSize: 11, fontWeight: '500', marginTop: 2 },
  stockRight: { alignItems: 'flex-end', gap: 6 },
  changePill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, gap: 3 },
  changePillText: { fontSize: 12, fontWeight: '700' },
  impactRow: { flexDirection: 'row', alignItems: 'center' },
  impactLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  impactValue: { fontSize: 12, fontWeight: '800' },
  // Footer
  footerDisclaimer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, opacity: 0.6 },
  footerDisclaimerText: { color: colors.textMuted, fontSize: 10, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
});
