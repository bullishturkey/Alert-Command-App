import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Platform, Dimensions, Modal, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, formatPrice, formatNumber, getChartHTML } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

let WebView: any = null;
if (Platform.OS !== 'web') { WebView = require('react-native-webview').WebView; }
let LWC: any = null;
if (Platform.OS === 'web') { LWC = require('lightweight-charts'); }

const { width: SW, height: SH } = Dimensions.get('window');
const CHART_H = Math.round(SH * 0.46);

function NativeChart({ html }: { html: string }) {
  if (WebView) return <WebView source={{ html }} style={{ flex: 1, backgroundColor: 'transparent' }} scrollEnabled={false} javaScriptEnabled originWhitelist={['*']} />;
  return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#666' }}>Chart unavailable</Text></View>;
}

function WebChart({ candles, maConfig }: { candles: any; maConfig: number[] }) {
  const ref = useRef<View>(null);
  const chartRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !LWC || !ref.current || !candles?.t?.length) return;
    const node = ref.current as unknown as HTMLElement;
    if (!node) return;
    if (chartRef.current) { try { chartRef.current.remove(); } catch {} chartRef.current = null; }
    try {
      const chart = LWC.createChart(node, {
        width: node.clientWidth || SW, height: CHART_H,
        layout: { background: { type: 'solid', color: '#000' }, textColor: '#555', fontSize: 10 },
        grid: { vertLines: { color: '#0a0a0a' }, horzLines: { color: '#0a0a0a' } },
        crosshair: { mode: 0, vertLine: { color: 'rgba(0,212,160,0.3)', width: 1, style: 0, labelBackgroundColor: colors.green }, horzLine: { color: 'rgba(0,212,160,0.3)', width: 1, style: 0, labelBackgroundColor: colors.green } },
        rightPriceScale: { borderColor: '#111', scaleMargins: { top: 0.05, bottom: 0.2 } },
        timeScale: { borderColor: '#111', timeVisible: true, secondsVisible: false, barSpacing: 8 },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      });
      chartRef.current = chart;
      const data = candles.t.map((t: number, i: number) => ({ time: t, open: candles.o[i], high: candles.h[i], low: candles.l[i], close: candles.c[i] }));
      const volData = candles.t.map((t: number, i: number) => ({ time: t, value: candles.v[i], color: candles.c[i] >= candles.o[i] ? 'rgba(0,212,160,0.25)' : 'rgba(245,70,107,0.25)' }));
      const cs = chart.addCandlestickSeries({ upColor: colors.green, downColor: colors.red, borderUpColor: colors.green, borderDownColor: colors.red, wickUpColor: colors.greenDim, wickDownColor: colors.redDim });
      cs.setData(data);
      // 7MA → green, 21MA → red (matches LOCKED_MAS order)
      const MA_COLORS = [colors.green, colors.red, '#FFFFFF', colors.yellow];
      maConfig.forEach((period, idx) => {
        if (data.length < period) return;
        const line = chart.addLineSeries({ color: MA_COLORS[idx % MA_COLORS.length], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        const result: any[] = [];
        for (let i = period - 1; i < data.length; i++) {
          let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j].close;
          result.push({ time: data[i].time, value: sum / period });
        }
        line.setData(result);
      });
      if (volData.length > 0) {
        const vs = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
        vs.setData(volData); chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => { if (node.clientWidth > 0) chart.applyOptions({ width: node.clientWidth, height: CHART_H }); });
      ro.observe(node);
      return () => { ro.disconnect(); try { chart.remove(); } catch {} chartRef.current = null; };
    } catch (e) { console.warn('Chart error:', e); }
  }, [candles, maConfig]);
  return <View ref={ref} style={{ width: '100%', height: CHART_H, backgroundColor: '#000' }} />;
}

const TIMEFRAMES = [{ key: '1', label: '1m' }, { key: '5', label: '5m' }, { key: '15', label: '15m' }, { key: '60', label: '1H' }, { key: 'D', label: '1D' }];

// Hard-locked MAs — 7MA (green = shorter-term momentum) + 21MA (red = longer-term trend)
const LOCKED_MAS = [7, 21];
const MA_COLORS = [colors.green, colors.red];

export default function ChartsScreen() {
  const [symbol, setSymbol] = useState('NDX');
  const [tf, setTf] = useState('1');
  const [candles, setCandles] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<any>(null);
  const [watchlist, setWatchlist] = useState<string[]>(['NDX']);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    (async () => {
      try { const d = await apiFetch('/api/watchlist'); setWatchlist(['NDX', ...(d.symbols || []).filter((s: string) => s !== 'NDX')]); } catch {}
    })();
  }, []);

  const fetchData = useCallback(async () => {
    // Don't clear chart while loading - keep old data visible
    setLoading(true);
    try {
      const [c, q] = await Promise.all([
        apiFetch(`/api/market/candles/${symbol}?resolution=${tf}&count=100`),
        apiFetch(`/api/market/quote/${symbol}`),
      ]);
      // Only update candles if we got valid data
      if (c && c.t && c.t.length > 0) {
        setCandles(c);
      }
      setQuote(q);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [symbol, tf]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh chart data to keep it as "live" as free API tiers allow.
  // Finnhub free tier = 60 calls/min. Even the tightest interval here uses < 10/min.
  useEffect(() => {
    const intervalMs =
      tf === '1' ? 15000 :       // 1m → every 15s
      tf === '5' ? 20000 :       // 5m → every 20s
      tf === '15' ? 30000 :      // 15m → every 30s
      tf === '60' ? 60000 :      // 1H → every 1 min
      300000;                    // 1D → every 5 min
    const id = setInterval(() => { fetchData(); }, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, tf]);

  const pos = quote ? quote.changePercent >= 0 : true;
  const ac = pos ? colors.green : colors.red;
  const li = candles?.t?.length ? candles.t.length - 1 : -1;

  // Calculate current MA values
  const maValues = LOCKED_MAS.map(period => {
    if (!candles?.c || candles.c.length < period) return null;
    let sum = 0;
    for (let i = candles.c.length - period; i < candles.c.length; i++) sum += candles.c[i];
    return sum / period;
  });

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Symbol Picker */}
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={s.pickOverlay}>
          <View style={s.pickCard}>
            <View style={s.pickHead}><Text style={s.pickTitle}>Select Symbol</Text><TouchableOpacity onPress={() => setShowPicker(false)}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity></View>
            <FlatList data={watchlist} keyExtractor={i => i} renderItem={({ item }) => (
              <TouchableOpacity style={[s.pickItem, symbol === item && s.pickItemOn]} onPress={() => { setSymbol(item); setShowPicker(false); }}>
                <Text style={[s.pickSym, symbol === item && { color: colors.green }]}>{item}</Text>
                {symbol === item && <Ionicons name="checkmark" size={18} color={colors.green} />}
              </TouchableOpacity>
            )} />
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={s.head}>
        <TouchableOpacity style={s.symBtn} onPress={() => setShowPicker(true)}>
          <Text style={s.symTxt}>{symbol}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={fetchData} style={s.refBtn}><Ionicons name="refresh" size={16} color={colors.textSecondary} /></TouchableOpacity>
      </View>

      {/* Price + Stats - Webull layout */}
      {quote && (
        <View style={s.priceRow}>
          <View style={s.priceLeft}>
            <Text style={[s.priceVal, { color: ac }]}>{formatPrice(quote.price)}</Text>
            <View style={s.chgRow}>
              <Ionicons name={pos ? 'caret-up' : 'caret-down'} size={11} color={ac} />
              <Text style={[s.chgTxt, { color: ac }]}>{pos ? '+' : ''}{quote.change?.toFixed(2)}  {pos ? '+' : ''}{quote.changePercent?.toFixed(2)}%</Text>
            </View>
          </View>
          <View style={s.priceRight}>
            <View style={s.statMini}><Text style={s.statMiniL} numberOfLines={1}>High</Text><Text style={s.statMiniV} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatPrice(quote.high)}</Text></View>
            <View style={s.statMini}><Text style={s.statMiniL} numberOfLines={1}>Low</Text><Text style={s.statMiniV} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatPrice(quote.low)}</Text></View>
            <View style={s.statMini}><Text style={s.statMiniL} numberOfLines={1}>Vol</Text><Text style={s.statMiniV} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatNumber(quote.volume)}</Text></View>
          </View>
        </View>
      )}

      {/* Stats Grid */}
      {quote && (
        <View style={s.statsGrid}>
          <View style={s.sg}><Text style={s.sgL}>Open</Text><Text style={s.sgV}>{formatPrice(quote.open)}</Text></View>
          <View style={s.sg}><Text style={s.sgL}>Prev Close</Text><Text style={s.sgV}>{formatPrice(quote.previousClose)}</Text></View>
        </View>
      )}

      {/* MA Indicator Labels (horizontally scrollable on narrow screens) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.maRow}>
        <Text style={s.maLabel}>MA({LOCKED_MAS.join(',')})</Text>
        {LOCKED_MAS.map((ma, i) => (
          <View key={ma} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 2, borderRadius: 1, backgroundColor: MA_COLORS[i] }} />
            <Text style={[s.maVal, { color: MA_COLORS[i] }]}>
              MA{ma}: {maValues[i] != null ? maValues[i]!.toFixed(2) : '-'}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Chart */}
      <View style={s.chartWrap}>
        {Platform.OS === 'web' ? <WebChart candles={candles} maConfig={LOCKED_MAS} />
          : candles ? <NativeChart html={getChartHTML(candles, symbol, LOCKED_MAS)} />
          : <View style={s.chartLoad}><ActivityIndicator size="large" color={colors.green} /></View>}
        {loading && candles && (
          <View style={s.chartOverlay}><ActivityIndicator size="small" color={colors.green} /></View>
        )}
        {loading && !candles && (
          <View style={s.chartLoad}><ActivityIndicator size="large" color={colors.green} /></View>
        )}
      </View>

      {/* Timeframes */}
      <View style={s.tfRow}>
        {TIMEFRAMES.map(t => (
          <TouchableOpacity key={t.key} style={[s.tfBtn, tf === t.key && s.tfOn]} onPress={() => setTf(t.key)}>
            <Text style={[s.tfTxt, tf === t.key && s.tfTxtOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Disclaimer */}
      <View style={s.disclaimer}>
        <Ionicons name="information-circle-outline" size={11} color={colors.textMuted} />
        <Text style={s.disclaimerTxt}>Not affiliated with Nasdaq, Inc. or any stock exchange. Informational only — not financial advice.</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  symBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  symTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  refBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  // Price row - Webull style
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 4 },
  priceLeft: { flex: 1 },
  priceVal: { fontSize: 26, fontWeight: '800' },
  chgRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  chgTxt: { fontSize: 12, fontWeight: '600' },
  priceRight: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  statMini: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statMiniL: { color: colors.textMuted, fontSize: 11, minWidth: 36, textAlign: 'right' },
  statMiniV: { color: '#ccc', fontSize: 11, fontWeight: '600', minWidth: 80, textAlign: 'right' },
  // Stats grid
  statsGrid: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 4, gap: 20 },
  sg: { flexDirection: 'row', gap: 8 },
  sgL: { color: colors.textMuted, fontSize: 10 },
  sgV: { color: '#aaa', fontSize: 10, fontWeight: '600' },
  // MA row
  maRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4, gap: 6, flexWrap: 'wrap' },
  maLabel: { color: colors.textMuted, fontSize: 10 },
  maVal: { fontSize: 10, fontWeight: '600' },
  // Chart
  chartWrap: { width: SW, height: CHART_H, backgroundColor: '#000' },
  chartLoad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chartOverlay: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 6 },
  // Timeframes
  tfRow: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 4 },
  tfBtn: { flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center' },
  tfOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.green },
  tfTxt: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tfTxtOn: { color: colors.green },
  // Disclaimer
  disclaimer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 4, paddingTop: 2, gap: 4, opacity: 0.55 },
  disclaimerTxt: { color: colors.textMuted, fontSize: 9, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  // Picker
  pickOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  pickCard: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: SH * 0.5, borderWidth: 1, borderColor: colors.border },
  pickHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pickItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  pickItemOn: { backgroundColor: colors.greenBg },
  pickSym: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
