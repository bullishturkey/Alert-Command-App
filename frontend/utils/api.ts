import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOKEN_KEY } from '../constants/auth';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

export function formatPrice(price: number): string {
  return price >= 1000 ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : price.toFixed(2);
}

export function timeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diff = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Webull-style palette: mint-teal bullish / rose bearish
const CHART_GREEN = '#00D4A0';
const CHART_GREEN_DIM = '#00A87E';
const CHART_RED = '#F5466B';
const CHART_RED_DIM = '#D63B58';
// MA palette (matches charts.tsx): 7MA red, 21MA green, 200MA white, 365MA yellow
const MA_COLORS_DEFAULT = [CHART_RED, CHART_GREEN, '#FFFFFF', '#FFD60A'];

export function getChartHTML(
  candles: any,
  symbol: string,
  maConfig: number[] = [7, 21],
  theme: 'dark' | 'light' = 'dark',
): string {
  if (!candles || !candles.t || candles.t.length === 0) {
    return '<html><body style="background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui"><p>No chart data available</p></body></html>';
  }
  const data = candles.t.map((time: number, i: number) => ({
    time,
    open: candles.o[i],
    high: candles.h[i],
    low: candles.l[i],
    close: candles.c[i],
  }));
  const volumeData = candles.t.map((time: number, i: number) => ({
    time,
    value: candles.v[i],
    color: candles.c[i] >= candles.o[i] ? 'rgba(0,212,160,0.25)' : 'rgba(245,70,107,0.25)',
  }));

  // Pre-compute MA series server-side to avoid heavy JS execution inside WebView
  const maSeries: Array<{ period: number; color: string; data: Array<{ time: number; value: number }> }> = [];
  maConfig.forEach((period, idx) => {
    if (!period || period <= 0 || data.length < period) return;
    const color = MA_COLORS_DEFAULT[idx % MA_COLORS_DEFAULT.length];
    const series: Array<{ time: number; value: number }> = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j].close;
      series.push({ time: data[i].time, value: sum / period });
    }
    maSeries.push({ period, color, data: series });
  });

  return `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;overflow:hidden}#chart{width:100vw;height:100vh}</style>
</head><body><div id="chart"></div><script>
const chart=LightweightCharts.createChart(document.getElementById('chart'),{
  layout:{background:{type:'solid',color:'#000'},textColor:'#A0A0A8',fontSize:11},
  grid:{vertLines:{color:'#141416'},horzLines:{color:'#141416'}},
  crosshair:{mode:0,vertLine:{color:'#606068',width:1,style:3},horzLine:{color:'#606068',width:1,style:3}},
  rightPriceScale:{borderColor:'#1C1C20',scaleMargins:{top:0.1,bottom:0.25}},
  timeScale:{borderColor:'#1C1C20',timeVisible:true,secondsVisible:false},
  handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
  handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true}
});
const cs=chart.addCandlestickSeries({upColor:'${CHART_GREEN}',downColor:'${CHART_RED}',borderUpColor:'${CHART_GREEN}',borderDownColor:'${CHART_RED}',wickUpColor:'${CHART_GREEN_DIM}',wickDownColor:'${CHART_RED_DIM}'});
cs.setData(${JSON.stringify(data)});
const vs=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'vol',scaleMargins:{top:0.8,bottom:0}});
vs.setData(${JSON.stringify(volumeData)});
chart.priceScale('vol').applyOptions({scaleMargins:{top:0.8,bottom:0}});
// Moving averages
const MA_LIST = ${JSON.stringify(maSeries)};
MA_LIST.forEach(ma => {
  const line = chart.addLineSeries({ color: ma.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'MA' + ma.period });
  line.setData(ma.data);
});
chart.timeScale().fitContent();
new ResizeObserver(()=>{chart.applyOptions({width:document.body.clientWidth,height:document.body.clientHeight})}).observe(document.body);
</script></body></html>`;
}
