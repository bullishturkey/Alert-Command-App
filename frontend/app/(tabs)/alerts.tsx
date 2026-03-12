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
  created_by: string;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  bullish: { icon: 'trending-up', color: '#00C805', bg: 'rgba(0,200,5,0.1)' },
  bearish: { icon: 'trending-down', color: '#FF5000', bg: 'rgba(255,80,0,0.1)' },
  neutral: { icon: 'remove', color: '#FFD60A', bg: 'rgba(255,214,10,0.1)' },
  info: { icon: 'information-circle', color: '#0A84FF', bg: 'rgba(10,132,255,0.1)' },
};

const SEVERITY_COLORS: Record<string, string> = { high: '#FF5000', medium: '#FFD60A', low: '#A1A1AA' };

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

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const renderAlert = ({ item }: { item: Alert }) => {
    const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.info;
    const sevColor = SEVERITY_COLORS[item.severity] || '#A1A1AA';
    return (
      <View testID={`alert-item-${item.id}`} style={[styles.alertCard, { borderLeftColor: config.color, borderLeftWidth: 3 }]}>
        <View style={styles.alertHeader}>
          <View style={[styles.iconBadge, { backgroundColor: config.bg }]}>
            <Ionicons name={config.icon as any} size={18} color={config.color} />
          </View>
          <View style={styles.alertHeaderText}>
            <Text style={styles.alertTitle} numberOfLines={1}>{item.title}</Text>
            <View style={styles.alertMeta}>
              {item.ticker ? <Text style={[styles.tickerBadge, { color: config.color }]}>{item.ticker}</Text> : null}
              <View style={[styles.severityDot, { backgroundColor: sevColor }]} />
              <Text style={styles.alertTime}>{timeAgo(item.created_at)}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.alertMessage}>{item.message}</Text>
        <Text style={styles.alertBy}>by {item.created_by}</Text>
      </View>
    );
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{alerts.length}</Text></View>
      </View>
      <FlatList
        testID="alerts-list"
        data={alerts}
        keyExtractor={item => item.id}
        renderItem={renderAlert}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor="#00C805" />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="notifications-off" size={48} color="#555" /><Text style={styles.emptyText}>No alerts yet</Text></View>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  countBadge: { backgroundColor: '#00C805', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  countText: { color: '#000', fontSize: 13, fontWeight: '700' },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  alertCard: { backgroundColor: '#1C1C1E', borderRadius: 12, padding: 16, marginBottom: 10 },
  alertHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  iconBadge: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  alertHeaderText: { flex: 1 },
  alertTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tickerBadge: { fontSize: 12, fontWeight: '700' },
  severityDot: { width: 6, height: 6, borderRadius: 3 },
  alertTime: { color: '#555', fontSize: 11 },
  alertMessage: { color: '#A1A1AA', fontSize: 14, lineHeight: 20 },
  alertBy: { color: '#555', fontSize: 11, marginTop: 8 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: '#555', fontSize: 15 },
});
