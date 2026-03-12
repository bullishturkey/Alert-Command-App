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
            <Ionicons name="flash" size={12} color="#FFD60A" />
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
            <Ionicons name="pulse" size={12} color="#555" />
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
            <Text style={styles.emptyTitle}>Waiting for Signals</Text>
            <Text style={styles.emptyText}>When TradingView conditions are met, NDX price alerts will appear here instantly.</Text>
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

  alertCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 18, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: '#FFD60A' },
  alertCardNewest: { borderLeftColor: '#00C805', borderWidth: 1, borderColor: 'rgba(0,200,5,0.2)' },

  alertTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  signalBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  signalText: { color: '#FFD60A', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  alertTime: { color: '#555', fontSize: 12 },

  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  ndxLabel: { color: '#A1A1AA', fontSize: 16, fontWeight: '700' },
  atSymbol: { color: '#555', fontSize: 14 },
  priceValue: { color: '#fff', fontSize: 28, fontWeight: '800' },

  alertMessage: { color: '#A1A1AA', fontSize: 13, lineHeight: 18, marginBottom: 8 },

  alertBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourceText: { color: '#555', fontSize: 11 },
  newBadge: { backgroundColor: 'rgba(0,200,5,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  newBadgeText: { color: '#00C805', fontSize: 10, fontWeight: '800' },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
