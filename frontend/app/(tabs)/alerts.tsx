import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';

interface Alert {
  id: string;
  title: string;
  message: string;
  type: string;
  ticker: string;
  severity: string;
  source: string;
  price: string;
  direction: string;
  timeframe: string;
  created_by: string;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  bullish: { icon: 'trending-up', color: '#00C805', bg: 'rgba(0,200,5,0.1)', label: 'BULLISH' },
  bearish: { icon: 'trending-down', color: '#FF5000', bg: 'rgba(255,80,0,0.1)', label: 'BEARISH' },
  neutral: { icon: 'remove', color: '#FFD60A', bg: 'rgba(255,214,10,0.1)', label: 'NEUTRAL' },
  info: { icon: 'information-circle', color: '#0A84FF', bg: 'rgba(10,132,255,0.1)', label: 'INFO' },
};

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
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const renderAlert = ({ item }: { item: Alert }) => {
    const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.info;
    return (
      <View testID={`alert-item-${item.id}`} style={styles.alertCard}>
        {/* Alert Header */}
        <View style={styles.alertTop}>
          <View style={[styles.typeBadge, { backgroundColor: config.bg }]}>
            <Ionicons name={config.icon as any} size={14} color={config.color} />
            <Text style={[styles.typeLabel, { color: config.color }]}>{config.label}</Text>
          </View>
          <View style={styles.alertMeta}>
            <View style={styles.sourceBadge}>
              <Ionicons name={item.source === 'pipedream' ? 'flash' : 'shield-checkmark'} size={10} color="#A1A1AA" />
              <Text style={styles.sourceText}>{item.source === 'pipedream' ? 'TradingView' : 'Admin'}</Text>
            </View>
            <Text style={styles.alertTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>

        {/* Alert Content */}
        <Text style={styles.alertTitle}>{item.title}</Text>
        <Text style={styles.alertMessage}>{item.message}</Text>

        {/* Trading Meta (price, direction, timeframe) */}
        {(item.price || item.direction || item.timeframe) && (
          <View style={styles.tradingMeta}>
            {item.price ? (
              <View style={styles.metaChip}>
                <Ionicons name="pricetag" size={11} color="#A1A1AA" />
                <Text style={styles.metaText}>{item.price}</Text>
              </View>
            ) : null}
            {item.direction ? (
              <View style={[styles.metaChip, { backgroundColor: item.direction === 'long' ? 'rgba(0,200,5,0.1)' : 'rgba(255,80,0,0.1)' }]}>
                <Ionicons name={item.direction === 'long' ? 'arrow-up' : 'arrow-down'} size={11} color={item.direction === 'long' ? '#00C805' : '#FF5000'} />
                <Text style={[styles.metaText, { color: item.direction === 'long' ? '#00C805' : '#FF5000' }]}>{item.direction.toUpperCase()}</Text>
              </View>
            ) : null}
            {item.timeframe ? (
              <View style={styles.metaChip}>
                <Ionicons name="time" size={11} color="#A1A1AA" />
                <Text style={styles.metaText}>{item.timeframe}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* Bottom bar */}
        <View style={styles.alertBottom}>
          <View style={[styles.tickerBadge, { borderColor: config.color }]}>
            <Text style={[styles.tickerText, { color: config.color }]}>{item.ticker || 'NDX'}</Text>
          </View>
          <View style={[styles.severityIndicator, { backgroundColor: item.severity === 'high' ? '#FF5000' : item.severity === 'medium' ? '#FFD60A' : '#A1A1AA' }]} />
        </View>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>NDX Alerts</Text>
          <Text style={styles.subtitle}>TradingView Pipeline</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor="#00C805" />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="flash-outline" size={56} color="#27272A" />
            <Text style={styles.emptyTitle}>No Active Alerts</Text>
            <Text style={styles.emptyText}>NDX trading alerts from your TradingView pipeline will appear here in real-time.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 12, color: '#555', marginTop: 2 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,200,5,0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00C805' },
  liveText: { color: '#00C805', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  alertCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 12 },
  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, gap: 5 },
  typeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sourceText: { color: '#555', fontSize: 10, fontWeight: '600' },
  alertTime: { color: '#555', fontSize: 11 },
  alertTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6, lineHeight: 22 },
  alertMessage: { color: '#A1A1AA', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  tradingMeta: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  metaChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#27272A', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, gap: 5 },
  metaText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  alertBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tickerBadge: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 },
  tickerText: { fontSize: 12, fontWeight: '800' },
  severityIndicator: { width: 8, height: 8, borderRadius: 4 },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
