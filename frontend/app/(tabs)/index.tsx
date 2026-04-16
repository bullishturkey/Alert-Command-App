import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Image, TextInput, Modal, Alert } from 'react-native';
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
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [addingSymbol, setAddingSymbol] = useState(false);

  // Fetch user's watchlist
  const fetchWatchlist = useCallback(async () => {
    try {
      const data = await apiFetch('/api/watchlist');
      setWatchlist(data.symbols || []);
    } catch (e) {
      console.error('Watchlist fetch error:', e);
    }
  }, []);

  const fetchNdx = useCallback(async () => {
    try {
      const data = await apiFetch('/api/market/ndx');
      setNdx(data);
    } catch (e) {
      console.error('NDX fetch error:', e);
    }
  }, []);

  // Fetch quotes based on watchlist
  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const symbolsParam = watchlist.join(',');
      const data = await apiFetch(`/api/market/quote-multi?symbols=${symbolsParam}`);
      setQuotes(data.quotes || []);
    } catch (e) {
      console.error('Fetch quotes error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [watchlist]);

  useEffect(() => {
    fetchWatchlist();
    fetchNdx();
    const ndxInterval = setInterval(fetchNdx, 5000);
    return () => { clearInterval(ndxInterval); };
  }, [fetchNdx, fetchWatchlist]);

  useEffect(() => {
    if (watchlist.length > 0) {
      fetchQuotes();
      const quotesInterval = setInterval(fetchQuotes, 30000);
      return () => clearInterval(quotesInterval);
    } else {
      setLoading(false);
    }
  }, [watchlist, fetchQuotes]);

  const onRefresh = () => { setRefreshing(true); fetchWatchlist(); fetchNdx(); };

  const addSymbol = async () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    if (watchlist.includes(sym)) {
      Alert.alert('Already Added', `${sym} is already in your watchlist.`);
      return;
    }
    setAddingSymbol(true);
    try {
      await apiFetch('/api/watchlist/add', { method: 'POST', body: JSON.stringify({ symbol: sym }) });
      setNewSymbol('');
      setShowAddModal(false);
      const wlData = await apiFetch('/api/watchlist');
      const updatedSymbols = wlData.symbols || [];
      setWatchlist(updatedSymbols);
      // Immediately fetch quotes for the updated watchlist
      const symbolsParam = updatedSymbols.join(',');
      const qData = await apiFetch(`/api/market/quote-multi?symbols=${symbolsParam}`);
      setQuotes(qData.quotes || []);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add symbol');
    } finally {
      setAddingSymbol(false);
    }
  };

  const removeSymbol = async (sym: string) => {
    try {
      await apiFetch('/api/watchlist/remove', { method: 'POST', body: JSON.stringify({ symbol: sym }) });
      setWatchlist(prev => prev.filter(s => s !== sym));
      setQuotes(prev => prev.filter(q => q.symbol !== sym));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to remove symbol');
    }
  };

  const confirmRemove = (sym: string) => {
    Alert.alert('Remove from Watchlist', `Remove ${sym}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeSymbol(sym) },
    ]);
  };

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
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.cardPrice}>${formatPrice(item.price)}</Text>
          <View style={[styles.changeBadge, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={10} color={color} />
            <Text style={[styles.changeText, { color }]}>{isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%</Text>
          </View>
        </View>
        {/* Long press to remove */}
        <TouchableOpacity style={styles.removeBtn} onPress={() => confirmRemove(item.symbol)}>
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Add Symbol Modal */}
      <Modal visible={showAddModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add to Watchlist</Text>
            <Text style={styles.modalSubtitle}>Enter a ticker or pick from suggestions</Text>
            <TextInput
              style={styles.modalInput}
              value={newSymbol}
              onChangeText={setNewSymbol}
              placeholder="e.g. AAPL, TSLA, GOOG"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoFocus
              maxLength={10}
            />
            {/* Ticker Suggestions */}
            <View style={styles.suggestionsWrap}>
              {[
                { sym: 'NFLX', name: 'Netflix' },
                { sym: 'COST', name: 'Costco' },
                { sym: 'CRM', name: 'Salesforce' },
                { sym: 'INTC', name: 'Intel' },
                { sym: 'PYPL', name: 'PayPal' },
                { sym: 'UBER', name: 'Uber' },
                { sym: 'COIN', name: 'Coinbase' },
                { sym: 'HOOD', name: 'Robinhood' },
                { sym: 'SQ', name: 'Block' },
                { sym: 'PLTR', name: 'Palantir' },
                { sym: 'SNOW', name: 'Snowflake' },
                { sym: 'SHOP', name: 'Shopify' },
                { sym: 'MSTR', name: 'MicroStrat' },
                { sym: 'SPOT', name: 'Spotify' },
                { sym: 'PANW', name: 'Palo Alto' },
              ].filter(s => !watchlist.includes(s.sym) && (
                !newSymbol.trim() || s.sym.includes(newSymbol.toUpperCase()) || s.name.toUpperCase().includes(newSymbol.toUpperCase())
              )).slice(0, 8).map(s => (
                <TouchableOpacity key={s.sym} style={styles.suggestionChip} onPress={() => setNewSymbol(s.sym)}>
                  <Text style={styles.suggestionSym}>{s.sym}</Text>
                  <Text style={styles.suggestionName}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setShowAddModal(false); setNewSymbol(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalAddBtn, (!newSymbol.trim() || addingSymbol) && { opacity: 0.5 }]} onPress={addSymbol} disabled={!newSymbol.trim() || addingSymbol}>
                {addingSymbol ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.modalAddText}>Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

      {/* Section Title with Add Button */}
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionPrefix}>⟩</Text>
          <Text style={styles.sectionTitle}>My Watchlist</Text>
          <Text style={styles.sectionCount}>({watchlist.length})</Text>
        </View>
        <TouchableOpacity style={styles.addStockBtn} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={18} color={colors.green} />
        </TouchableOpacity>
      </View>

      <FlatList
        testID="quotes-list"
        data={quotes}
        keyExtractor={(item) => item.symbol}
        renderItem={renderStockCard}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Ionicons name="add-circle-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>Your watchlist is empty</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={() => setShowAddModal(true)}>
              <Ionicons name="add" size={16} color="#000" />
              <Text style={styles.emptyAddText}>Add Stocks</Text>
            </TouchableOpacity>
          </View>
        }
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
  ndxStats: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderSubtle },
  ndxStat: { flex: 1, alignItems: 'center' },
  ndxStatLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginBottom: 2, letterSpacing: 0.3 },
  ndxStatValue: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  ndxStatDivider: { width: 1, backgroundColor: colors.borderSubtle },

  // Section Header
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 18, fontWeight: '800' },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  sectionCount: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  addStockBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.greenBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },

  // Stock Cards
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 20 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.md },
  symbolBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, marginRight: spacing.md },
  symbolText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  cardInfo: { flex: 1 },
  cardName: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  cardRight: { alignItems: 'flex-end', marginRight: 28 },
  cardPrice: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  changeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginTop: 4, gap: 2 },
  changeText: { fontSize: 11, fontWeight: '700' },
  removeBtn: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceHover, justifyContent: 'center', alignItems: 'center' },

  // Empty Watchlist
  emptyList: { alignItems: 'center', paddingTop: 40, gap: spacing.md },
  emptyText: { color: colors.textTertiary, fontSize: 14 },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.green, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, gap: 4 },
  emptyAddText: { color: '#000', fontSize: 14, fontWeight: '700' },

  // Add Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xxl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.lg },
  modalInput: { backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 14, color: colors.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: 1, textAlign: 'center' },
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  suggestionChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceHover, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, gap: 4, borderWidth: 1, borderColor: colors.border },
  suggestionSym: { color: colors.green, fontSize: 12, fontWeight: '800' },
  suggestionName: { color: colors.textMuted, fontSize: 10, fontWeight: '500' },
  modalActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.surfaceHover, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  modalAddBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.green, alignItems: 'center' },
  modalAddText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
