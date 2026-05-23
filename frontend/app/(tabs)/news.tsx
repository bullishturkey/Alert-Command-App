import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { readCache, writeCache, CACHE_KEYS, CACHE_TTL_MS } from '../../utils/deviceCache';
import { colors, spacing, radius } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import GuestGate from '../../components/GuestGate';
import { useAppForeground } from '../../hooks/useAppForeground';

interface EconomicEvent {
  event: string; date: string; time_utc?: string; time?: string; impact: string; category: string;
  estimate: string; previous: string; actual?: string; description: string; sentiment?: string;
}
interface Earning { symbol: string; date: string; hour: string; epsEstimate: number | null; revenueEstimate: number | null; epsActual?: number | null; revenueActual?: number | null; reported?: boolean; }
interface NewsItem { id: string; headline: string; source: string; summary: string; sentiment: string; url: string; timestamp: string; }
interface AISentiment {
  overall_sentiment: string;
  confidence: number;
  summary: string;
  key_drivers: string[];
  ndx_outlook: string;
  risk_factors: string[];
  trade_bias: string;
}
interface MoverRow { symbol: string; name: string; change_pct: number; price: number; }
interface WeeklyRecap {
  week_key: string;
  week_label: string;
  indexes: MoverRow[];
  top_gainers: MoverRow[];
  top_losers: MoverRow[];
  key_news: NewsItem[];
}

const IMPACT = { high: { color: colors.red, bg: colors.redBg, label: 'HIGH' }, medium: { color: colors.yellow, bg: colors.yellowBg, label: 'MED' }, low: { color: colors.textSecondary, bg: 'rgba(161,161,170,0.08)', label: 'LOW' } } as Record<string, any>;
const CAT_ICON: Record<string, string> = { fed: 'business', inflation: 'trending-up', employment: 'people', economic: 'bar-chart' };
const SENT_COLOR: Record<string, string> = { bullish: colors.green, bearish: colors.red, neutral: colors.textSecondary };

function fmtRev(v: number | null) { if (!v) return '-'; if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`; if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`; return `$${v}`; }
function localYMD(dt: Date) {
  // YYYY-MM-DD in the user's LOCAL timezone (not UTC).
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function isToday(d: string) { return d === localYMD(new Date()); }
function isTomorrow(d: string) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return d === localYMD(t);
}
function fmtTime(utc?: string, fb?: string) {
  if (utc) {
    try {
      // Finnhub returns economic calendar times in UTC as "YYYY-MM-DD HH:mm:ss" (no tz marker).
      // JS would parse this as LOCAL time — normalize to ISO-UTC so it converts correctly
      // into the user's device timezone (e.g. 12:30 UTC → 8:30 AM ET).
      let iso = utc.trim();
      if (!iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
        iso = iso.replace(' ', 'T') + 'Z';
      }
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {}
  }
  return fb || '';
}
function fmtDate(d: string) { try { return new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); } catch { return d; } }

function guessSentiment(event: EconomicEvent): string {
  const name = (event.event || '').toLowerCase();
  if (name.includes('cpi') || name.includes('ppi') || name.includes('inflation')) return event.impact === 'high' ? 'bearish' : 'neutral';
  if (name.includes('employment') || name.includes('payroll') || name.includes('jobs')) return 'bullish';
  if (name.includes('gdp') || name.includes('retail')) return 'bullish';
  if (name.includes('rate') || name.includes('fomc') || name.includes('fed')) return 'neutral';
  return 'neutral';
}

export default function PreflightScreen() {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [aiSentiment, setAiSentiment] = useState<AISentiment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiExpanded, setAiExpanded] = useState(true);
  const [aiMode, setAiMode] = useState<'live' | 'weekly_recap' | 'daily_recap'>('live');
  const [weeklyRecap, setWeeklyRecap] = useState<WeeklyRecap | null>(null);
  const [dailyRecap, setDailyRecap] = useState<any>(null);
  const [ndxPrice, setNdxPrice] = useState<number | null>(null);
  const [ndxChange, setNdxChange] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const { user, isGuest } = useAuth();
  const isAdmin = user?.is_admin === true;

  // ── Load device cache on mount — instant display of last-saved data ──────
  useEffect(() => {
    if (isGuest) return;
    (async () => {
      const [cachedPF, cachedAI] = await Promise.all([
        readCache<{ events: EconomicEvent[]; earnings: Earning[]; news: NewsItem[] }>(
          CACHE_KEYS.PREFLIGHT, CACHE_TTL_MS.PREFLIGHT
        ),
        readCache<{ sentiment: AISentiment; mode: string; weekly_recap: WeeklyRecap | null; daily_recap: any; ndx_price?: number; ndx_change?: number }>(
          CACHE_KEYS.AI_SENTIMENT, CACHE_TTL_MS.AI_SENTIMENT
        ),
      ]);
      if (cachedPF) {
        setEvents(cachedPF.data.events);
        setEarnings(cachedPF.data.earnings);
        setNews(cachedPF.data.news);
        setLoading(false);
      }
      if (cachedAI?.data?.sentiment) {
        setAiSentiment(cachedAI.data.sentiment);
        setAiMode(cachedAI.data.mode as any || 'live');
        setWeeklyRecap(cachedAI.data.weekly_recap || null);
        setDailyRecap(cachedAI.data.daily_recap || null);
        if (cachedAI.data.ndx_price) setNdxPrice(cachedAI.data.ndx_price);
        if (cachedAI.data.ndx_change !== undefined) setNdxChange(cachedAI.data.ndx_change);
      }
    })();
  }, [isGuest]);

  const fetchData = useCallback(async () => {
    try {
      const d = await apiFetch('/api/preflight');
      const ev = d.economic_events || [];
      const earn = d.earnings || [];
      const bn = d.breaking_news || [];
      setEvents(ev); setEarnings(earn); setNews(bn);
      setIsOffline(false);
      writeCache(CACHE_KEYS.PREFLIGHT, { events: ev, earnings: earn, news: bn });
    } catch (e) { console.error(e); setIsOffline(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const fetchAISentiment = useCallback(async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const data = await apiFetch('/api/ai/sentiment');
      if (data.sentiment) {
        setAiSentiment(data.sentiment);
        if (data.ndx_price) setNdxPrice(data.ndx_price);
        if (data.ndx_change !== undefined) setNdxChange(data.ndx_change);
      }
      setAiMode(data.mode === 'weekly_recap' ? 'weekly_recap' : data.mode === 'daily_recap' ? 'daily_recap' : 'live');
      setWeeklyRecap(data.weekly_recap || null);
      setDailyRecap(data.daily_recap || null);
      if (data.error && !data.sentiment?.summary) {
        setAiError(data.error);
      }
      // Persist real (non-placeholder) data to device cache
      if (!data.pending && data.sentiment?.summary) {
        writeCache(CACHE_KEYS.AI_SENTIMENT, {
          sentiment: data.sentiment,
          mode: data.mode,
          weekly_recap: data.weekly_recap || null,
          daily_recap: data.daily_recap || null,
          ndx_price: data.ndx_price,
          ndx_change: data.ndx_change,
        });
      }
      // If backend is still generating, auto-retry after 15s
      if (data.pending) {
        setTimeout(() => fetchAISentiment(), 15000);
      }
    } catch (e: any) {
      // On timeout/network error, retry once after 20s before showing error
      setAiError('');
      setTimeout(async () => {
        try {
          const data = await apiFetch('/api/ai/sentiment');
          if (data.sentiment) setAiSentiment(data.sentiment);
          setAiMode(data.mode === 'weekly_recap' ? 'weekly_recap' : data.mode === 'daily_recap' ? 'daily_recap' : 'live');
          setWeeklyRecap(data.weekly_recap || null);
          setDailyRecap(data.daily_recap || null);
        } catch {
          setAiError('AI analysis unavailable. Pull down to refresh.');
        }
      }, 20000);
      console.error('AI sentiment error (will retry):', e);
    } finally {
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isGuest) return;
    fetchData(); fetchAISentiment();
    const i = setInterval(fetchData, 60000);
    return () => clearInterval(i);
  }, [fetchData, fetchAISentiment, isGuest]);

  // Silent refresh when app comes back to foreground
  useAppForeground(() => { if (!isGuest) { fetchData(); } });

  const toggleExpand = (i: number) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  if (isGuest) {
    return (
      <GuestGate
        featureName="Preflight"
        icon="airplane"
        description="AI-powered daily market brief: economic calendar, earnings, breaking news, and Claude sentiment analysis. Create a free account to unlock."
      />
    );
  }

  if (loading) return <View style={st.ctr}><ActivityIndicator size="large" color={colors.green} /></View>;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const sentColor = aiSentiment ? (SENT_COLOR[aiSentiment.overall_sentiment] || colors.textSecondary) : colors.textSecondary;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <FlatList data={[1]} keyExtractor={() => 'pf'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View style={st.content}>
            <View style={st.header}>
              <View><View style={st.hRow}><Text style={st.prefix}>⟩</Text><Text style={st.title}>Preflight</Text></View><Text style={st.dateTxt}>{today}</Text></View>
              <View style={st.badge}><Ionicons name="airplane" size={13} color={colors.blue} /><Text style={st.badgeTxt}>DAILY BRIEF</Text></View>
            </View>

            {/* AI Sentiment Card */}
            <View style={st.section}>
              {(() => { return null; })()}
              {(() => { return null; })()}
              <TouchableOpacity style={st.secHead} onPress={() => setAiExpanded(!aiExpanded)} activeOpacity={0.7}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Ionicons name={aiMode !== 'live' ? 'calendar' : 'sparkles'} size={16} color={aiMode !== 'live' ? colors.blue : colors.green} />
                  <Text style={st.secTitle}>{aiMode === 'weekly_recap' ? 'Week in Review' : aiMode === 'daily_recap' ? "Today's Recap" : 'AI Market Intelligence'}</Text>
                  {aiMode === 'weekly_recap' && weeklyRecap?.week_label ? (
                    <View style={st.weekPill}><Text style={st.weekPillTxt}>{weeklyRecap.week_label}</Text></View>
                  ) : aiMode === 'daily_recap' && dailyRecap?.date_label ? (
                    <View style={st.weekPill}><Text style={st.weekPillTxt}>{dailyRecap.date_label}</Text></View>
                  ) : null}
                </View>
                <Ionicons name={aiExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>

              {(() => {
                const recap: any = aiMode === 'weekly_recap' ? weeklyRecap : aiMode === 'daily_recap' ? dailyRecap : null;
                if (!aiExpanded || !recap || !(recap.indexes?.length > 0 || recap.top_gainers?.length > 0)) return null;
                const badgeLabel = aiMode === 'weekly_recap' ? 'MARKETS CLOSED · WEEKEND RECAP' : 'MARKETS CLOSED · DAILY RECAP';
                return (
                <View style={st.recapCard}>
                  <View style={st.recapClosedBadge}>
                    <Ionicons name="moon" size={11} color={colors.blue} />
                    <Text style={st.recapClosedTxt}>{badgeLabel}</Text>
                  </View>

                  {/* Index performance grid */}
                  {recap.indexes?.length > 0 && (
                    <>
                      <Text style={st.recapSectionLabel}>INDEX PERFORMANCE</Text>
                      <View style={st.indexGrid}>
                        {recap.indexes.map((idx: MoverRow, i: number) => {
                          const isUp = idx.change_pct >= 0;
                          const idxColor = idx.symbol === 'VIX' ? (isUp ? colors.red : colors.green) : (isUp ? colors.green : colors.red);
                          const displaySym = idx.symbol === 'GSPC' ? 'SP500' : idx.symbol;
                          return (
                            <View key={i} style={st.indexCell}>
                              <Text style={st.indexSym}>{displaySym}</Text>
                              <Text style={[st.indexChg, { color: idxColor }]}>{isUp ? '+' : ''}{idx.change_pct.toFixed(2)}%</Text>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {/* Gainers / Losers two-column */}
                  {(recap.top_gainers?.length > 0 || recap.top_losers?.length > 0) && (
                    <View style={st.moversWrap}>
                      {recap.top_gainers?.length > 0 && (
                        <View style={st.moversCol}>
                          <View style={st.moversHeader}>
                            <Ionicons name="trending-up" size={11} color={colors.green} />
                            <Text style={[st.moversTitle, { color: colors.green }]}>TOP WINS</Text>
                          </View>
                          {recap.top_gainers.map((g: MoverRow, i: number) => (
                            <View key={i} style={st.moverRow}>
                              <Text style={st.moverSym}>{g.symbol}</Text>
                              <Text style={[st.moverPct, { color: colors.green }]}>+{g.change_pct.toFixed(2)}%</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {recap.top_losers?.length > 0 && (
                        <View style={st.moversCol}>
                          <View style={st.moversHeader}>
                            <Ionicons name="trending-down" size={11} color={colors.red} />
                            <Text style={[st.moversTitle, { color: colors.red }]}>{aiMode === 'weekly_recap' ? 'BOTTOM 5' : 'TOP LOSSES'}</Text>
                          </View>
                          {recap.top_losers.map((l: MoverRow, i: number) => {
                            const isDown = l.change_pct < 0;
                            return (
                              <View key={i} style={st.moverRow}>
                                <Text style={st.moverSym}>{l.symbol}</Text>
                                <Text style={[st.moverPct, { color: isDown ? colors.red : colors.textSecondary }]}>{isDown ? '' : '+'}{l.change_pct.toFixed(2)}%</Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
                );
              })()}

              {aiExpanded && (
                <View style={[st.aiCard, aiMode !== 'live' ? { marginTop: 12 } : null]}>
                  {aiLoading ? (
                    <View style={st.aiLoadingWrap}>
                      <ActivityIndicator size="small" color={colors.green} />
                      <Text style={st.aiLoadingTxt}>Analyzing market conditions...</Text>
                    </View>
                  ) : aiSentiment ? (
                    <>
                      {/* Sentiment Header */}
                      <View style={st.aiHeader}>
                        <View style={[st.aiSentBadge, { backgroundColor: sentColor + '18', borderColor: sentColor + '30' }]}>
                          <Ionicons
                            name={aiSentiment.overall_sentiment === 'bullish' ? 'arrow-up-circle' : aiSentiment.overall_sentiment === 'bearish' ? 'arrow-down-circle' : 'remove-circle'}
                            size={18} color={sentColor}
                          />
                          <Text style={[st.aiSentTxt, { color: sentColor }]}>{(aiSentiment.overall_sentiment || 'NEUTRAL').toUpperCase()}</Text>
                          <View style={[st.aiConfBadge, { backgroundColor: sentColor + '25' }]}>
                            <Text style={[st.aiConfTxt, { color: sentColor }]}>{aiSentiment.confidence}/10</Text>
                          </View>
                        </View>
                        {ndxPrice && (
                          <View style={st.aiNdxWrap}>
                            <Text style={st.aiNdxLabel}>NDX</Text>
                            <Text style={st.aiNdxPrice}>${ndxPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                            {ndxChange !== null && <Text style={[st.aiNdxChg, { color: ndxChange >= 0 ? colors.green : colors.red }]}>{ndxChange >= 0 ? '+' : ''}{ndxChange.toFixed(2)}%</Text>}
                          </View>
                        )}
                      </View>

                      {/* Summary */}
                      <Text style={st.aiSummary}>{aiSentiment.summary}</Text>

                      {/* NDX Outlook */}
                      {aiSentiment.ndx_outlook ? (
                        <View style={st.aiOutlook}>
                          <View style={st.aiOutlookHeader}>
                            <Ionicons name="trending-up" size={13} color={colors.green} />
                            <Text style={st.aiOutlookTitle}>NDX Outlook</Text>
                          </View>
                          <Text style={st.aiOutlookTxt}>{aiSentiment.ndx_outlook}</Text>
                        </View>
                      ) : null}

                      {/* Key Drivers */}
                      {aiSentiment.key_drivers && aiSentiment.key_drivers.length > 0 && (
                        <View style={st.aiDrivers}>
                          <Text style={st.aiSectionLabel}>KEY DRIVERS</Text>
                          {aiSentiment.key_drivers.map((d, i) => (
                            <View key={i} style={st.aiDriverRow}>
                              <View style={st.aiDriverDot} />
                              <Text style={st.aiDriverTxt}>{d}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Risk Factors */}
                      {aiSentiment.risk_factors && aiSentiment.risk_factors.length > 0 && (
                        <View style={st.aiRisks}>
                          <Text style={st.aiSectionLabel}>RISK FACTORS</Text>
                          {aiSentiment.risk_factors.map((r, i) => (
                            <View key={i} style={st.aiRiskRow}>
                              <Ionicons name="warning" size={11} color={colors.yellow} />
                              <Text style={st.aiRiskTxt}>{r}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Trade Bias */}
                      {aiSentiment.trade_bias ? (
                        <View style={[st.aiTradeBias, { borderColor: sentColor + '30' }]}>
                          <Ionicons name="bulb" size={14} color={colors.yellow} />
                          <Text style={st.aiTradeBiasTxt}>{aiSentiment.trade_bias}</Text>
                        </View>
                      ) : null}

                      {isAdmin && (
                        <TouchableOpacity style={st.aiRefreshBtn} onPress={fetchAISentiment}>
                          <Ionicons name="refresh" size={12} color={colors.textMuted} />
                          <Text style={st.aiRefreshTxt}>Refresh Analysis</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  ) : aiError ? (
                    <View style={st.aiErrorWrap}>
                      <Ionicons name="alert-circle" size={20} color={colors.yellow} />
                      <Text style={st.aiErrorTxt}>{aiError}</Text>
                      <TouchableOpacity style={st.aiRetryBtn} onPress={fetchAISentiment}>
                        <Text style={st.aiRetryTxt}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {/* Economic Calendar - Expandable */}
            <View style={st.section}>
              <View style={st.secHead}><Ionicons name="calendar" size={16} color={colors.yellow} /><Text style={st.secTitle}>Economic Calendar</Text></View>
              {events.length === 0 ? <View style={st.emptyS}><Text style={st.emptySTxt}>No major economic events this week</Text></View> : (
                events.map((ev, i) => {
                  const imp = IMPACT[ev.impact] || IMPACT.medium;
                  const icon = CAT_ICON[ev.category] || 'analytics';
                  const td = isToday(ev.date);
                  const tm = !td && isTomorrow(ev.date);
                  const lt = fmtTime(ev.time_utc, ev.time);
                  const ld = fmtDate(ev.date);
                  const dateLabel = td ? 'TODAY' : tm ? 'TOMORROW' : ld;
                  const dateHighlight = td || tm;
                  const sent = ev.sentiment || guessSentiment(ev);
                  const sentColorEv = SENT_COLOR[sent] || colors.textSecondary;
                  const isExp = expanded[i] === true;
                  return (
                    <TouchableOpacity key={i} style={[st.eventCard, td && st.eventToday]} onPress={() => toggleExpand(i)} activeOpacity={0.7}>
                      <View style={st.eventMain}>
                        <View style={[st.eventIcon, { backgroundColor: imp.bg }]}><Ionicons name={icon as any} size={15} color={imp.color} /></View>
                        <View style={st.eventContent}>
                          <View style={st.eventTopRow}>
                            <Text style={st.eventName} numberOfLines={1}>{ev.event}</Text>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[st.sentBadge, { backgroundColor: sentColorEv + '18' }]}>
                                <Ionicons name={sent === 'bullish' ? 'arrow-up' : sent === 'bearish' ? 'arrow-down' : 'remove'} size={9} color={sentColorEv} />
                                <Text style={[st.sentTxt, { color: sentColorEv }]}>{sent.toUpperCase()}</Text>
                              </View>
                              <View style={[st.impBadge, { backgroundColor: imp.bg }]}><Text style={[st.impTxt, { color: imp.color }]}>{imp.label}</Text></View>
                            </View>
                          </View>
                          <View style={st.eventMeta}>
                            <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                            <Text style={st.eventTime}>{lt}</Text>
                            <Text style={[st.eventDateL, td && { color: colors.yellow }]}>{td ? 'TODAY' : ld}</Text>
                            <Ionicons name={isExp ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} style={{ marginLeft: 'auto' }} />
                          </View>
                        </View>
                      </View>
                      {isExp && (
                        <View style={st.expandedArea}>
                          {ev.description ? <Text style={st.expandDesc}>{ev.description}</Text> : null}
                          <View style={st.expandGrid}>
                            <View style={st.expandItem}>
                              <Text style={st.expandLabel}>Expected</Text>
                              <Text style={st.expandValue}>{ev.estimate || '-'}</Text>
                            </View>
                            <View style={st.expandItem}>
                              <Text style={st.expandLabel}>Actual</Text>
                              <Text style={[st.expandValue, ev.actual ? { color: colors.green, fontWeight: '800' } : {}]}>{ev.actual || 'Pending'}</Text>
                            </View>
                            <View style={st.expandItem}>
                              <Text style={st.expandLabel}>Previous</Text>
                              <Text style={st.expandValue}>{ev.previous || '-'}</Text>
                            </View>
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {/* Earnings — mega-caps ($600B+), past 7 days + next 60 days */}
            <View style={st.section}>
              <View style={st.secHead}><Ionicons name="bar-chart" size={16} color={colors.blue} /><Text style={st.secTitle}>Mega-Cap Earnings</Text></View>
              {earnings.length === 0 ? <View style={st.emptyS}><Text style={st.emptySTxt}>No mega-cap earnings reports in the window</Text></View> : (
                earnings.map((e, i) => {
                  const beat = e.reported && e.epsActual != null && e.epsEstimate != null && e.epsActual > e.epsEstimate;
                  const miss = e.reported && e.epsActual != null && e.epsEstimate != null && e.epsActual < e.epsEstimate;
                  const beatColor = beat ? colors.green : miss ? colors.red : colors.textSecondary;
                  return (
                    <View key={i} style={[st.earnCard, e.reported && { opacity: 0.92, borderLeftWidth: 3, borderLeftColor: beat ? colors.green : miss ? colors.red : colors.textTertiary }]}>
                      <View style={st.earnLeft}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={st.earnSym}>{e.symbol}</Text>
                          {e.reported && (
                            <View style={{ backgroundColor: beat ? colors.greenBg : miss ? colors.redBg : 'rgba(160,160,168,0.15)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                              <Text style={{ color: beatColor, fontSize: 9, fontWeight: '700', letterSpacing: 0.3 }}>
                                {beat ? 'BEAT' : miss ? 'MISS' : 'REPORTED'}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={st.earnDate}>{fmtDate(e.date)}</Text>
                      </View>
                      <View style={st.earnRight}>
                        <View style={st.earnRow}>
                          <Text style={st.earnLbl}>EPS {e.reported ? 'Act' : 'Est'}</Text>
                          <Text style={[st.earnVal, e.reported && { color: beatColor }]}>
                            {e.reported
                              ? (e.epsActual != null ? `$${e.epsActual.toFixed(2)}` : '-')
                              : (e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : '-')}
                          </Text>
                        </View>
                        <View style={st.earnRow}>
                          <Text style={st.earnLbl}>Rev {e.reported ? 'Act' : 'Est'}</Text>
                          <Text style={[st.earnVal, e.reported && { color: beatColor }]}>
                            {e.reported ? fmtRev(e.revenueActual ?? null) : fmtRev(e.revenueEstimate)}
                          </Text>
                        </View>
                      </View>
                      <View style={[st.earnHour, { backgroundColor: e.hour === 'bmo' ? colors.yellowBg : colors.blueBg }]}>
                        <Text style={[st.earnHourTxt, { color: e.hour === 'bmo' ? colors.yellow : colors.blue }]}>
                          {e.hour === 'bmo' ? 'Pre-Mkt' : e.hour === 'amc' ? 'After-Hrs' : e.hour || '-'}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            {/* Breaking News */}
            <View style={st.section}>
              <View style={st.secHead}><Ionicons name="flash" size={16} color={colors.red} /><Text style={st.secTitle}>Breaking News</Text></View>
              {news.map((item, i) => (
                <TouchableOpacity key={item.id} style={st.newsCard} onPress={() => item.url && Linking.openURL(item.url)} activeOpacity={0.7}>
                  <View style={st.newsTop}><Text style={st.newsSrc}>{item.source}</Text><View style={[st.sentDot, { backgroundColor: SENT_COLOR[item.sentiment] || colors.textSecondary }]} /></View>
                  <Text style={st.newsHead} numberOfLines={2}>{item.headline}</Text>
                  <Text style={st.newsTime}>{timeAgo(item.timestamp)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, ctr: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  offlineTxt: { color: 'rgba(255,255,255,0.38)', fontSize: 11 },
  content: { paddingBottom: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { color: colors.green, fontSize: 22, fontWeight: '800' }, title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  dateTxt: { fontSize: 12, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  badge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.blueBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 5, borderWidth: 1, borderColor: 'rgba(10,132,255,0.12)' },
  badgeTxt: { color: colors.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  section: { marginBottom: 24 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12, gap: 8 },
  secTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyS: { marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  emptySTxt: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },

  // AI Sentiment Card
  aiCard: { marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },

  // Weekly Recap Card (weekend mode)
  weekPill: { backgroundColor: 'rgba(10,132,255,0.12)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(10,132,255,0.2)' },
  weekPillTxt: { color: colors.blue, fontSize: 10, fontWeight: '700' },
  recapCard: { marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(10,132,255,0.2)' },
  recapClosedBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, backgroundColor: 'rgba(10,132,255,0.1)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(10,132,255,0.15)' },
  recapClosedTxt: { color: colors.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  recapSectionLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },
  indexGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  indexCell: { flexBasis: '31%', flexGrow: 1, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.borderSubtle },
  indexSym: { color: '#fff', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  indexChg: { fontSize: 13, fontWeight: '800' },
  moversWrap: { flexDirection: 'row', gap: 10, marginTop: 4 },
  moversCol: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.borderSubtle },
  moversHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  moversTitle: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  moverRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  moverSym: { color: '#fff', fontSize: 12, fontWeight: '700' },
  moverPct: { fontSize: 12, fontWeight: '800' },
  aiLoadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20, justifyContent: 'center' },
  aiLoadingTxt: { color: colors.textSecondary, fontSize: 13 },
  aiHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  aiSentBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 100, borderWidth: 1 },
  aiSentTxt: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  aiConfBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  aiConfTxt: { fontSize: 10, fontWeight: '800' },
  aiNdxWrap: { alignItems: 'flex-end' },
  aiNdxLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  aiNdxPrice: { color: '#fff', fontSize: 16, fontWeight: '800' },
  aiNdxChg: { fontSize: 11, fontWeight: '700' },
  aiSummary: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  aiOutlook: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.borderSubtle },
  aiOutlookHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aiOutlookTitle: { color: colors.green, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  aiOutlookTxt: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  aiDrivers: { marginBottom: 12 },
  aiSectionLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  aiDriverRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  aiDriverDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green, marginTop: 5 },
  aiDriverTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
  aiRisks: { marginBottom: 12 },
  aiRiskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  aiRiskTxt: { color: colors.textTertiary, fontSize: 12, flex: 1, lineHeight: 17 },
  aiTradeBias: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,214,10,0.05)', borderRadius: 10, padding: 12, borderWidth: 1, marginBottom: 12 },
  aiTradeBiasTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17, fontWeight: '600' },
  aiRefreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 },
  aiRefreshTxt: { color: colors.textMuted, fontSize: 10, fontWeight: '600' },
  aiErrorWrap: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  aiErrorTxt: { color: colors.textTertiary, fontSize: 12, textAlign: 'center' },
  aiRetryBtn: { backgroundColor: colors.greenBg, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  aiRetryTxt: { color: colors.green, fontSize: 12, fontWeight: '700' },

  // Economic Events - expandable
  eventCard: { backgroundColor: colors.surface, marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  eventToday: { borderColor: 'rgba(255,214,10,0.25)' },
  eventMain: { flexDirection: 'row' },
  eventIcon: { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  eventContent: { flex: 1 },
  eventTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  eventName: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1, marginRight: 6 },
  sentBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, gap: 2 },
  sentTxt: { fontSize: 8, fontWeight: '800', letterSpacing: 0.3 },
  impBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  impTxt: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eventTime: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  eventDateL: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  // Expanded area
  expandedArea: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  expandDesc: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  expandGrid: { flexDirection: 'row', gap: 8 },
  expandItem: { flex: 1, backgroundColor: colors.bg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.borderSubtle, alignItems: 'center' },
  expandLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.3, marginBottom: 3 },
  expandValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  // Earnings
  earnCard: { backgroundColor: colors.surface, marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  earnLeft: { marginRight: 16 }, earnSym: { color: '#fff', fontSize: 15, fontWeight: '700' }, earnDate: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  earnRight: { flex: 1, gap: 3 }, earnRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earnLbl: { color: colors.textMuted, fontSize: 11 }, earnVal: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  earnHour: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 }, earnHourTxt: { fontSize: 9, fontWeight: '700' },
  // News
  newsCard: { backgroundColor: colors.surface, marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  newsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  newsSrc: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sentDot: { width: 7, height: 7, borderRadius: 4 },
  newsHead: { color: '#fff', fontSize: 13, fontWeight: '600', lineHeight: 19 },
  newsTime: { color: colors.textMuted, fontSize: 10, marginTop: 5 },
});
