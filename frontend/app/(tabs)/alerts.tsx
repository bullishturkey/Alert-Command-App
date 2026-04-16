import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

interface Alert {
  id: string;
  title: string;
  message: string;
  type: string;
  ticker: string;
  price: string;
  source: string;
  created_by: string;
  created_at: string;
}

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await apiFetch('/api/alerts');
      setAlerts(data.alerts || []);
    } catch (e) {
      console.error('Fetch alerts error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const renderAlert = ({ item, index }: { item: Alert; index: number }) => {
    const isNewest = index === 0;
    return (
      <View testID={`alert-item-${item.id}`} style={[styles.alertCard, isNewest && styles.alertCardNewest]}>
        <View style={styles.alertTop}>
          <View style={styles.signalBadge}>
            <Ionicons name="flash" size={11} color={colors.yellow} />
            <Text style={styles.signalText}>TRADE SIGNAL</Text>
          </View>
          <Text style={styles.alertTime}>{timeAgo(item.created_at)}</Text>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.ndxLabel}>NDX</Text>
          <Text style={styles.atSymbol}>@</Text>
          <Text style={styles.priceValue}>{item.price || item.message}</Text>
        </View>

        {item.message && item.message !== item.title && item.message !== item.price && (
          <Text style={styles.alertMessage}>{item.message}</Text>
        )}

        <View style={styles.alertBottom}>
          <View style={styles.sourceRow}>
            <Ionicons name="pulse" size={11} color={colors.textMuted} />
            <Text style={styles.sourceText}>{item.created_by || 'TradingView'}</Text>
          </View>
          {isNewest && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <View style={styles.headerTitleRow}>
            <Text style={styles.sectionPrefix}>⟩</Text>
            <Text style={styles.title}>NDX Alerts</Text>
          </View>
          <Text style={styles.subtitle}>TradingView → Pipedream Pipeline</Text>
        </View>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <FlatList
        testID="alerts-list"
        data={alerts}
        keyExtractor={item => item.id}
        renderItem={renderAlert}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="flash-outline" size={48} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Waiting for Signals</Text>
            <Text style={styles.emptyText}>When TradingView conditions are met, NDX price alerts will appear here instantly.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 11, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, gap: 5, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: 20 },

  alertCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.yellow },
  alertCardNewest: { borderLeftColor: colors.green, borderColor: 'rgba(0,200,5,0.15)' },

  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  signalBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.yellowBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  signalText: { color: colors.yellow, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  alertTime: { color: colors.textMuted, fontSize: 11 },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: spacing.sm },
  ndxLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
  atSymbol: { color: colors.textMuted, fontSize: 13 },
  priceValue: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },

  alertMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },

  alertBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceText: { color: colors.textMuted, fontSize: 10, fontWeight: '500' },
  newBadge: { backgroundColor: colors.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  newBadgeText: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: spacing.md },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
