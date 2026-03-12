import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, formatPrice, formatNumber, getChartHTML } from '../../utils/api';

const TIMEFRAMES = ['1', '5', '15', '60', 'D'];
const TF_LABELS: Record<string, string> = { '1': '1m', '5': '5m', '15': '15m', '60': '1H', 'D': '1D' };

export default function StockDetailScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<any>(null);
  const [candles, setCandles] = useState<any>(null);
  const [timeframe, setTimeframe] = useState('D');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [q, c] = await Promise.all([
        apiFetch(`/api/market/quote/${symbol}`),
        apiFetch(`/api/market/candles/${symbol}?resolution=${timeframe}&count=100`),
      ]);
      setQuote(q);
      setCandles(c);
    } catch (e) {
      console.error('Stock detail error:', e);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isPositive = quote ? quote.changePercent >= 0 : true;
  const color = isPositive ? '#00C805' : '#FF5000';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="stock-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerSymbol}>{symbol}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Price Section */}
          {quote && (
            <View style={styles.priceSection}>
              <Text style={styles.priceName}>{quote.name}</Text>
              <Text style={styles.priceValue}>${formatPrice(quote.price)}</Text>
              <View style={styles.changeRow}>
                <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={16} color={color} />
                <Text style={[styles.changeValue, { color }]}>${Math.abs(quote.change).toFixed(2)} ({isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%)</Text>
                <Text style={styles.changeLabel}>Today</Text>
              </View>
            </View>
          )}

          {/* Chart */}
          <View style={styles.chartContainer}>
            <WebView
              testID="stock-chart-webview"
              source={{ html: getChartHTML(candles, symbol || '') }}
              style={styles.webview}
              scrollEnabled={false}
              javaScriptEnabled
              originWhitelist={['*']}
            />
          </View>

          {/* Timeframes */}
          <View style={styles.tfRow}>
            {TIMEFRAMES.map(tf => (
              <TouchableOpacity testID={`stock-tf-${tf}`} key={tf} style={[styles.tfBtn, timeframe === tf && styles.tfBtnActive]} onPress={() => setTimeframe(tf)}>
                <Text style={[styles.tfText, timeframe === tf && styles.tfTextActive]}>{TF_LABELS[tf]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Stats Grid */}
          {quote && (
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Open</Text>
                <Text style={styles.statValue}>${formatPrice(quote.open)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>High</Text>
                <Text style={[styles.statValue, { color: '#00C805' }]}>${formatPrice(quote.high)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Low</Text>
                <Text style={[styles.statValue, { color: '#FF5000' }]}>${formatPrice(quote.low)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Prev Close</Text>
                <Text style={styles.statValue}>${formatPrice(quote.previousClose)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Volume</Text>
                <Text style={styles.statValue}>{formatNumber(quote.volume)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Sentiment</Text>
                <Text style={[styles.statValue, { color: quote.sentiment === 'bullish' ? '#00C805' : quote.sentiment === 'bearish' ? '#FF5000' : '#FFD60A' }]}>{quote.sentiment?.charAt(0).toUpperCase() + quote.sentiment?.slice(1)}</Text>
              </View>
            </View>
          )}

          {/* Indicators */}
          <View style={styles.indicatorsSection}>
            <Text style={styles.sectionTitle}>Indicators</Text>
            <View style={styles.indicatorRow}>
              {['VWAP', 'RSI', 'MA 20', 'MA 50', 'EMA 9'].map(ind => (
                <View key={ind} style={styles.indicatorChip}>
                  <Text style={styles.indicatorText}>{ind}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },
  headerSymbol: { color: '#fff', fontSize: 18, fontWeight: '700' },
  priceSection: { paddingHorizontal: 20, paddingBottom: 8 },
  priceName: { color: '#A1A1AA', fontSize: 14, marginBottom: 4 },
  priceValue: { color: '#fff', fontSize: 36, fontWeight: '700' },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  changeValue: { fontSize: 15, fontWeight: '600' },
  changeLabel: { color: '#555', fontSize: 13, marginLeft: 8 },
  chartContainer: { height: 300, marginHorizontal: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  tfRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 14, gap: 10 },
  tfBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1C1C1E' },
  tfBtnActive: { backgroundColor: '#27272A', borderWidth: 1, borderColor: '#00C805' },
  tfText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  tfTextActive: { color: '#00C805' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 10, marginBottom: 20 },
  statItem: { width: '47%', backgroundColor: '#1C1C1E', borderRadius: 12, padding: 14 },
  statLabel: { color: '#555', fontSize: 12, marginBottom: 4 },
  statValue: { color: '#fff', fontSize: 16, fontWeight: '600' },
  indicatorsSection: { paddingHorizontal: 20, marginBottom: 30 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  indicatorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indicatorChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#27272A' },
  indicatorText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
});
