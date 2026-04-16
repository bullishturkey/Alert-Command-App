import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Platform, Dimensions, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CHART_HEIGHT = Math.round(SCREEN_H * 0.48);

function NativeChart({ html }: { html: string }) {
  if (WebView) {
    return <WebView source={{ html }} style={{ flex: 1, backgroundColor: 'transparent' }} scrollEnabled={false} javaScriptEnabled originWhitelist={['*']} />;
  }
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.textSecondary }}>Chart unavailable</Text></View>;
}

function WebChart({ candles }: { candles: any }) {
  const containerRef = useRef<View>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !LWC || !containerRef.current || !candles?.t?.length) return;
    const node = containerRef.current as unknown as HTMLElement;
    if (!node) return;

    if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; }

    try {
      const chart = LWC.createChart(node, {
        width: node.clientWidth || SCREEN_W,
        height: CHART_HEIGHT,
        layout: { background: { type: 'solid', color: '#000' }, textColor: '#666', fontSize: 10 },
        grid: { vertLines: { color: '#0a0a0a' }, horzLines: { color: '#0a0a0a' } },
        crosshair: {
          mode: 0,
          vertLine: { color: 'rgba(0,200,5,0.3)', width: 1, style: 0, labelBackgroundColor: '#00C805' },
          horzLine: { color: 'rgba(0,200,5,0.3)', width: 1, style: 0, labelBackgroundColor: '#00C805' },
        },
        rightPriceScale: { borderColor: '#111', scaleMargins: { top: 0.05, bottom: 0.2 }, autoScale: true },
        timeScale: { borderColor: '#111', timeVisible: true, secondsVisible: false, barSpacing: 8 },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });
      chartRef.current = chart;

      const data = candles.t.map((time: number, i: number) => ({
        time, open: candles.o[i], high: candles.h[i], low: candles.l[i], close: candles.c[i],
      }));
      const volData = candles.t.map((time: number, i: number) => ({
        time, value: candles.v[i],
        color: candles.c[i] >= candles.o[i] ? 'rgba(0,200,5,0.25)' : 'rgba(255,68,68,0.25)',
      }));

      const cs = chart.addCandlestickSeries({
        upColor: '#00C805', downColor: '#FF4444',
        borderUpColor: '#00C805', borderDownColor: '#FF4444',
        wickUpColor: '#00A004', wickDownColor: '#CC3333',
      });
      cs.setData(data);

      // MA lines
      const ma5 = chart.addLineSeries({ color: '#FFD60A', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const ma20 = chart.addLineSeries({ color: '#0A84FF', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const calcMA = (period: number) => {
        const result: any[] = [];
        for (let i = period - 1; i < data.length; i++) {
          let sum = 0;
          for (let j = 0; j < period; j++) sum += data[i - j].close;
          result.push({ time: data[i].time, value: sum / period });
        }
        return result;
      };
      if (data.length >= 5) ma5.setData(calcMA(5));
      if (data.length >= 20) ma20.setData(calcMA(20));

      if (volData.length > 0) {
        const vs = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
        vs.setData(volData);
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (node.clientWidth > 0) chart.applyOptions({ width: node.clientWidth, height: CHART_HEIGHT });
      });
      ro.observe(node);
      return () => { ro.disconnect(); try { chart.remove(); } catch {} chartRef.current = null; };
    } catch (e) { console.warn('Chart error:', e); }
  }, [candles]);

  return <View ref={containerRef} style={{ width: '100%', height: CHART_HEIGHT, backgroundColor: '#000' }} />;
}

const TIMEFRAMES = [
  { key: '1', label: '1m' },
  { key: '5', label: '5m' },
  { key: '15', label: '15m' },
  { key: '60', label: '1H' },
  { key: 'D', label: '1D' },
];

export default function ChartsScreen() {
  const [symbol, setSymbol] = useState('NDX');
  const [timeframe, setTimeframe] = useState('D');
  const [candles, setCandles] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<any>(null);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>(['NDX']);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch('/api/watchlist');
        const syms = data.symbols || [];
        setWatchlistSymbols(['NDX', ...syms.filter((s: string) => s !== 'NDX')]);
      } catch { setWatchlistSymbols(['NDX', 'QQQ', 'NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL']); }
    })();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [candleData, quoteData] = await Promise.all([
        apiFetch(`/api/market/candles/${symbol}?resolution=${timeframe}&count=100`),
        apiFetch(`/api/market/quote/${symbol}`),
      ]);
      setCandles(candleData);
      setQuote(quoteData);
    } catch (e) { console.error('Chart fetch error:', e); }
    finally { setLoading(false); }
  }, [symbol, timeframe]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const isPositive = quote ? quote.changePercent >= 0 : true;
  const accentColor = isPositive ? colors.green : colors.red;

  // OHLC from latest candle
  const lastIdx = candles?.t?.length ? candles.t.length - 1 : -1;
  const ohlc = lastIdx >= 0 ? {
    o: candles.o[lastIdx], h: candles.h[lastIdx], l: candles.l[lastIdx], c: candles.c[lastIdx], v: candles.v[lastIdx],
  } : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Symbol Picker Modal */}
      <Modal visible={showSymbolPicker} animationType="slide" presentationStyle="formSheet" transparent>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Symbol</Text>
              <TouchableOpacity onPress={() => setShowSymbolPicker(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={watchlistSymbols}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.pickerItem, symbol === item && styles.pickerItemActive]}
                  onPress={() => { setSymbol(item); setShowSymbolPicker(false); }}
                >
                  <Text style={[styles.pickerSymbol, symbol === item && { color: colors.green }]}>{item}</Text>
                  {symbol === item && <Ionicons name="checkmark" size={18} color={colors.green} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Header - Webull style */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.symbolBtn} onPress={() => setShowSymbolPicker(true)}>
          <Text style={styles.symbolText}>{symbol}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <View style={styles.maLegend}>
            <View style={[styles.maLegendDot, { backgroundColor: '#FFD60A' }]} />
            <Text style={styles.maLegendText}>MA5</Text>
            <View style={[styles.maLegendDot, { backgroundColor: '#0A84FF' }]} />
            <Text style={styles.maLegendText}>MA20</Text>
          </View>
          <TouchableOpacity onPress={fetchData} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Price Section */}
      {quote && (
        <View style={styles.priceSection}>
          <Text style={[styles.priceValue, { color: accentColor }]}>${formatPrice(quote.price)}</Text>
          <View style={styles.priceChange}>
            <Ionicons name={isPositive ? 'caret-up' : 'caret-down'} size={12} color={accentColor} />
            <Text style={[styles.changeText, { color: accentColor }]}>
              {isPositive ? '+' : ''}${Math.abs(quote.change).toFixed(2)}  ({isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%)
            </Text>
          </View>
          {quote.name && <Text style={styles.companyName} numberOfLines={1}>{quote.name}</Text>}
        </View>
      )}

      {/* Chart - Full Width, No Margins */}
      <View style={styles.chartContainer}>
        {loading ? (
          <View style={styles.chartLoading}>
            <ActivityIndicator size="large" color={colors.green} />
          </View>
        ) : Platform.OS === 'web' ? (
          <WebChart candles={candles} />
        ) : (
          <NativeChart html={getChartHTML(candles, symbol)} />
        )}
      </View>

      {/* Timeframe Selector - Webull style */}
      <View style={styles.timeframeRow}>
        {TIMEFRAMES.map(tf => (
          <TouchableOpacity
            key={tf.key}
            style={[styles.tfBtn, timeframe === tf.key && styles.tfBtnActive]}
            onPress={() => setTimeframe(tf.key)}
          >
            <Text style={[styles.tfText, timeframe === tf.key && styles.tfTextActive]}>{tf.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* OHLC Data Bar */}
      {ohlc && (
        <View style={styles.ohlcRow}>
          <View style={styles.ohlcItem}>
            <Text style={styles.ohlcLabel}>O</Text>
            <Text style={styles.ohlcValue}>{ohlc.o?.toFixed(2)}</Text>
          </View>
          <View style={styles.ohlcItem}>
            <Text style={styles.ohlcLabel}>H</Text>
            <Text style={[styles.ohlcValue, { color: colors.green }]}>{ohlc.h?.toFixed(2)}</Text>
          </View>
          <View style={styles.ohlcItem}>
            <Text style={styles.ohlcLabel}>L</Text>
            <Text style={[styles.ohlcValue, { color: colors.red }]}>{ohlc.l?.toFixed(2)}</Text>
          </View>
          <View style={styles.ohlcItem}>
            <Text style={styles.ohlcLabel}>C</Text>
            <Text style={[styles.ohlcValue, { color: ohlc.c >= ohlc.o ? colors.green : colors.red }]}>{ohlc.c?.toFixed(2)}</Text>
          </View>
          <View style={styles.ohlcItem}>
            <Text style={styles.ohlcLabel}>Vol</Text>
            <Text style={styles.ohlcValue}>{formatNumber(ohlc.v)}</Text>
          </View>
        </View>
      )}

      {/* Key Stats */}
      {quote && (
        <View style={styles.statsRow}>
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>Open</Text>
            <Text style={styles.statValue}>${formatPrice(quote.open)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>High</Text>
            <Text style={[styles.statValue, { color: colors.green }]}>${formatPrice(quote.high)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>Low</Text>
            <Text style={[styles.statValue, { color: colors.red }]}>${formatPrice(quote.low)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>Prev</Text>
            <Text style={styles.statValue}>${formatPrice(quote.previousClose)}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  symbolBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  symbolText: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  maLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  maLegendDot: { width: 8, height: 2, borderRadius: 1 },
  maLegendText: { color: colors.textMuted, fontSize: 9, fontWeight: '600' },
  refreshBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },

  // Price
  priceSection: { paddingHorizontal: 16, paddingBottom: 6 },
  priceValue: { fontSize: 28, fontWeight: '800', letterSpacing: 0.3 },
  priceChange: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: '600' },
  companyName: { color: colors.textMuted, fontSize: 11, marginTop: 2, fontWeight: '500' },

  // Chart - edge to edge
  chartContainer: { width: SCREEN_W, height: CHART_HEIGHT, backgroundColor: '#000', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#0a0a0a' },
  chartLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Timeframes
  timeframeRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16, gap: 4 },
  tfBtn: { flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center', backgroundColor: 'transparent' },
  tfBtnActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.green },
  tfText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tfTextActive: { color: colors.green },

  // OHLC
  ohlcRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 6, gap: 2 },
  ohlcItem: { flex: 1, alignItems: 'center' },
  ohlcLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  ohlcValue: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 1 },

  // Stats
  statsRow: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
  statBlock: { flex: 1, alignItems: 'center' },
  statLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  statValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  statDivider: { width: 1, backgroundColor: colors.border },

  // Symbol Picker
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickerCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SCREEN_H * 0.5, borderWidth: 1, borderColor: colors.border },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  pickerItemActive: { backgroundColor: colors.greenBg },
  pickerSymbol: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
});
