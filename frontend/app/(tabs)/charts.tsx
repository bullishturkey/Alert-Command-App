import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, getChartHTML } from '../../utils/api';

const SYMBOLS = ['NDX', 'QQQ', 'NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL'];
const TIMEFRAMES = ['1', '5', '15', '60', 'D'];
const TF_LABELS: Record<string, string> = { '1': '1m', '5': '5m', '15': '15m', '60': '1H', 'D': '1D' };

export default function ChartsScreen() {
  const [symbol, setSymbol] = useState('NDX');
  const [timeframe, setTimeframe] = useState('D');
  const [candles, setCandles] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [candleData, quoteData] = await Promise.all([
        apiFetch(`/api/market/candles/${symbol}?resolution=${timeframe}&count=100`),
        apiFetch(`/api/market/quote/${symbol}`),
      ]);
      setCandles(candleData);
      setQuote(quoteData);
    } catch (e) {
      console.error('Chart fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isPositive = quote ? quote.changePercent >= 0 : true;
  const color = isPositive ? '#00C805' : '#FF5000';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Charts</Text>
        <TouchableOpacity testID="chart-refresh-btn" onPress={fetchData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#A1A1AA" />
        </TouchableOpacity>
      </View>

      {/* Symbol Picker */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.symbolScroll} contentContainerStyle={styles.symbolScrollContent}>
        {SYMBOLS.map(s => (
          <TouchableOpacity testID={`chart-symbol-${s}`} key={s} style={[styles.symbolPill, symbol === s && styles.symbolPillActive]} onPress={() => setSymbol(s)}>
            <Text style={[styles.symbolPillText, symbol === s && styles.symbolPillTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Quote Info */}
      {quote && (
        <View style={styles.quoteBar}>
          <Text style={styles.quoteSymbol}>{quote.symbol}</Text>
          <Text style={styles.quotePrice}>${typeof quote.price === 'number' ? quote.price.toFixed(2) : quote.price}</Text>
          <View style={[styles.quoteBadge, { backgroundColor: isPositive ? 'rgba(0,200,5,0.15)' : 'rgba(255,80,0,0.15)' }]}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={12} color={color} />
            <Text style={[styles.quoteChange, { color }]}>{isPositive ? '+' : ''}{quote.changePercent?.toFixed(2)}%</Text>
          </View>
        </View>
      )}

      {/* Chart */}
      <View style={styles.chartContainer}>
        {loading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator size="large" color="#00C805" />
          </View>
        ) : (
          <WebView
            testID="chart-webview"
            source={{ html: getChartHTML(candles, symbol) }}
            style={styles.webview}
            scrollEnabled={false}
            javaScriptEnabled
            originWhitelist={['*']}
          />
        )}
      </View>

      {/* Timeframe Selector */}
      <View style={styles.timeframeRow}>
        {TIMEFRAMES.map(tf => (
          <TouchableOpacity testID={`chart-tf-${tf}`} key={tf} style={[styles.tfBtn, timeframe === tf && styles.tfBtnActive]} onPress={() => setTimeframe(tf)}>
            <Text style={[styles.tfText, timeframe === tf && styles.tfTextActive]}>{TF_LABELS[tf]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Indicators */}
      <View style={styles.indicatorRow}>
        <View style={styles.indicatorPill}><Text style={styles.indicatorText}>VWAP</Text></View>
        <View style={styles.indicatorPill}><Text style={styles.indicatorText}>RSI</Text></View>
        <View style={styles.indicatorPill}><Text style={styles.indicatorText}>MA 20</Text></View>
        <View style={styles.indicatorPill}><Text style={styles.indicatorText}>MA 50</Text></View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' },
  symbolScroll: { maxHeight: 44, marginBottom: 8 },
  symbolScrollContent: { paddingHorizontal: 16, gap: 8 },
  symbolPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1C1C1E' },
  symbolPillActive: { backgroundColor: '#00C805' },
  symbolPillText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  symbolPillTextActive: { color: '#000' },
  quoteBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, gap: 12 },
  quoteSymbol: { color: '#A1A1AA', fontSize: 14, fontWeight: '600' },
  quotePrice: { color: '#fff', fontSize: 22, fontWeight: '700' },
  quoteBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 2 },
  quoteChange: { fontSize: 13, fontWeight: '700' },
  chartContainer: { flex: 1, marginHorizontal: 12, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden' },
  chartLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  timeframeRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  tfBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1C1C1E' },
  tfBtnActive: { backgroundColor: '#27272A', borderWidth: 1, borderColor: '#00C805' },
  tfText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  tfTextActive: { color: '#00C805' },
  indicatorRow: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 8, gap: 8 },
  indicatorPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#27272A' },
  indicatorText: { color: '#A1A1AA', fontSize: 11, fontWeight: '600' },
});
