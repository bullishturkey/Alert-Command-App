import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, getChartHTML } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

function WebChart({ html }: { html: string }) {
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, minHeight: 350 }}>
        <iframe
          srcDoc={html}
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#000' } as any}
        />
      </View>
    );
  }
  if (WebView) {
    return (
      <WebView
        testID="chart-webview"
        source={{ html }}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled
        originWhitelist={['*']}
      />
    );
  }
  return <View style={styles.chartLoading}><Text style={{ color: colors.textSecondary }}>Chart not available</Text></View>;
}

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
  const color = isPositive ? colors.green : colors.red;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.sectionPrefix}>⟩</Text>
          <Text style={styles.title}>Charts</Text>
        </View>
        <TouchableOpacity testID="chart-refresh-btn" onPress={fetchData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={18} color={colors.textSecondary} />
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
          <View style={[styles.quoteBadge, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={10} color={color} />
            <Text style={[styles.quoteChange, { color }]}>{isPositive ? '+' : ''}{quote.changePercent?.toFixed(2)}%</Text>
          </View>
        </View>
      )}

      {/* Chart */}
      <View style={styles.chartContainer}>
        {loading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator size="large" color={colors.green} />
          </View>
        ) : (
          <WebChart html={getChartHTML(candles, symbol)} />
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
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  refreshBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  symbolScroll: { maxHeight: 44, marginBottom: spacing.sm },
  symbolScrollContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  symbolPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  symbolPillActive: { backgroundColor: colors.green, borderColor: colors.green },
  symbolPillText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  symbolPillTextActive: { color: '#000' },
  quoteBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, gap: spacing.md },
  quoteSymbol: { color: colors.textTertiary, fontSize: 13, fontWeight: '700' },
  quotePrice: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  quoteBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 3 },
  quoteChange: { fontSize: 12, fontWeight: '700' },
  chartContainer: { flex: 1, marginHorizontal: spacing.md, backgroundColor: colors.bg, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  chartLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  timeframeRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  tfBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tfBtnActive: { backgroundColor: colors.surfaceHover, borderColor: colors.green },
  tfText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  tfTextActive: { color: colors.green },
  indicatorRow: { flexDirection: 'row', justifyContent: 'center', paddingBottom: spacing.sm, gap: spacing.sm },
  indicatorPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  indicatorText: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
});
