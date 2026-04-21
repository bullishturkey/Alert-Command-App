import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Platform, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, formatPrice, formatNumber, getChartHTML } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

let WebView: any = null;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').WebView;
}

let LWC: any = null;
if (Platform.OS === 'web') {
  LWC = require('lightweight-charts');
}

const DETAIL_CHART_HEIGHT = 300;

function StockChart({ candles, symbol }: { candles: any; symbol: string }) {
  const containerRef = useRef<View>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !LWC || !containerRef.current || !candles?.t?.length) return;

    const node = containerRef.current as unknown as HTMLElement;
    if (!node) return;

    if (chartRef.current) {
      try { chartRef.current.remove(); } catch {}
      chartRef.current = null;
    }

    try {
      const chart = LWC.createChart(node, {
        width: node.clientWidth || 370,
        height: DETAIL_CHART_HEIGHT,
        layout: { background: { type: 'solid', color: '#000' }, textColor: '#A0A0A8', fontSize: 11 },
        grid: { vertLines: { color: '#141416' }, horzLines: { color: '#141416' } },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: '#1C1C20', scaleMargins: { top: 0.1, bottom: 0.25 } },
        timeScale: { borderColor: '#1C1C20', timeVisible: true, secondsVisible: false },
      });
      chartRef.current = chart;

      const data = candles.t.map((time: number, i: number) => ({
        time, open: candles.o[i], high: candles.h[i], low: candles.l[i], close: candles.c[i],
      }));
      const volData = candles.t.map((time: number, i: number) => ({
        time, value: candles.v[i],
        color: candles.c[i] >= candles.o[i] ? 'rgba(0,212,160,0.25)' : 'rgba(245,70,107,0.25)',
      }));

      const cs = chart.addCandlestickSeries({
        upColor: colors.green, downColor: colors.red,
        borderUpColor: colors.green, borderDownColor: colors.red,
        wickUpColor: colors.greenDim, wickDownColor: colors.redDim,
      });
      cs.setData(data);

      if (volData.length > 0) {
        const vs = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
        vs.setData(volData);
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      }
      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (node.clientWidth > 0) chart.applyOptions({ width: node.clientWidth, height: DETAIL_CHART_HEIGHT });
      });
      ro.observe(node);
      return () => { ro.disconnect(); try { chart.remove(); } catch {} chartRef.current = null; };
    } catch (e) {
      console.warn('Stock chart error:', e);
    }
  }, [candles]);

  if (Platform.OS === 'web') {
    return <View ref={containerRef} style={{ width: '100%', height: DETAIL_CHART_HEIGHT, backgroundColor: '#000' }} />;
  }

  // Native: use WebView with HTML
  const html = getChartHTML(candles, symbol, [7, 21]);
  if (WebView) {
    return <WebView testID="stock-chart-webview" source={{ html }} style={{ flex: 1, backgroundColor: 'transparent' }} scrollEnabled={false} javaScriptEnabled originWhitelist={['*']} />;
  }
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textSecondary }}>Chart unavailable</Text></View>;
}

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
  const color = isPositive ? colors.green : colors.red;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="stock-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerSymbol}>{symbol}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Price Section */}
          {quote && (
            <View style={styles.priceSection}>
              <Text style={styles.priceName}>{quote.name}</Text>
              <Text style={styles.priceValue}>${formatPrice(quote.price)}</Text>
              <View style={styles.changeRow}>
                <View style={[styles.changeBadge, { backgroundColor: isPositive ? colors.greenBg : colors.redBg }]}>
                  <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={12} color={color} />
                  <Text style={[styles.changeValue, { color }]}>${Math.abs(quote.change).toFixed(2)} ({isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%)</Text>
                </View>
                <Text style={styles.changeLabel}>Today</Text>
              </View>
            </View>
          )}

          {/* Chart */}
          <View style={styles.chartContainer}>
            <StockChart candles={candles} symbol={symbol || ''} />
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
                <Text style={[styles.statValue, { color: colors.green }]}>${formatPrice(quote.high)}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Low</Text>
                <Text style={[styles.statValue, { color: colors.red }]}>${formatPrice(quote.low)}</Text>
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
                <Text style={[styles.statValue, { color: quote.sentiment === 'bullish' ? colors.green : quote.sentiment === 'bearish' ? colors.red : colors.yellow }]}>{quote.sentiment?.charAt(0).toUpperCase() + quote.sentiment?.slice(1)}</Text>
              </View>
            </View>
          )}

          {/* Indicators */}
          <View style={styles.indicatorsSection}>
            <View style={styles.indHeader}>
              <Text style={styles.indPrefix}>⟩</Text>
              <Text style={styles.indTitle}>Indicators</Text>
            </View>
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
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  headerSymbol: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  priceSection: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  priceName: { color: colors.textTertiary, fontSize: 13, marginBottom: 4, fontWeight: '500' },
  priceValue: { color: colors.textPrimary, fontSize: 36, fontWeight: '800' },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: spacing.sm },
  changeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, gap: 3 },
  changeValue: { fontSize: 14, fontWeight: '600' },
  changeLabel: { color: colors.textMuted, fontSize: 12 },
  chartContainer: { height: 300, marginHorizontal: spacing.md, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  tfRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  tfBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tfBtnActive: { backgroundColor: colors.surfaceHover, borderColor: colors.green },
  tfText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  tfTextActive: { color: colors.green },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.xl, gap: spacing.sm, marginBottom: spacing.xl },
  statItem: { width: '47%', backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border },
  statLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 4, fontWeight: '600', letterSpacing: 0.3 },
  statValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  indicatorsSection: { paddingHorizontal: spacing.xl, marginBottom: 30 },
  indHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  indPrefix: { color: colors.green, fontSize: 18, fontWeight: '800' },
  indTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  indicatorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  indicatorChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  indicatorText: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
});
