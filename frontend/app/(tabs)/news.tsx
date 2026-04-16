import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

interface EconomicEvent {
  event: string; date: string; time_utc?: string; time?: string; impact: string; category: string;
  estimate: string; previous: string; actual?: string; description: string; sentiment?: string;
}
interface Earning { symbol: string; date: string; hour: string; epsEstimate: number | null; revenueEstimate: number | null; }
interface NewsItem { id: string; headline: string; source: string; summary: string; sentiment: string; url: string; timestamp: string; }

const IMPACT = { high: { color: colors.red, bg: colors.redBg, label: 'HIGH' }, medium: { color: colors.yellow, bg: colors.yellowBg, label: 'MED' }, low: { color: colors.textSecondary, bg: 'rgba(161,161,170,0.08)', label: 'LOW' } } as Record<string, any>;
const CAT_ICON: Record<string, string> = { fed: 'business', inflation: 'trending-up', employment: 'people', economic: 'bar-chart' };
const SENT_COLOR: Record<string, string> = { bullish: colors.green, bearish: colors.red, neutral: colors.textSecondary };

function fmtRev(v: number | null) { if (!v) return '-'; if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`; if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`; return `$${v}`; }
function isToday(d: string) { return d === new Date().toISOString().split('T')[0]; }
function fmtTime(utc?: string, fb?: string) { if (utc) { try { const d = new Date(utc); if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); } catch {} } return fb || ''; }
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

  const fetchData = useCallback(async () => {
    try { const d = await apiFetch('/api/preflight'); setEvents(d.economic_events || []); setEarnings(d.earnings || []); setNews(d.breaking_news || []); }
    catch (e) { console.error(e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 60000); return () => clearInterval(i); }, [fetchData]);

  const toggleExpand = (i: number) => setExpanded(p => ({ ...p, [i]: !p[i] }));

  if (loading) return <View style={st.ctr}><ActivityIndicator size="large" color={colors.green} /></View>;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

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

            {/* Economic Calendar - Expandable */}
            <View style={st.section}>
              <View style={st.secHead}><Ionicons name="calendar" size={16} color={colors.yellow} /><Text style={st.secTitle}>Economic Calendar</Text></View>
              {events.length === 0 ? <View style={st.emptyS}><Text style={st.emptySTxt}>No major economic events this week</Text></View> : (
                events.map((ev, i) => {
                  const imp = IMPACT[ev.impact] || IMPACT.medium;
                  const icon = CAT_ICON[ev.category] || 'analytics';
                  const td = isToday(ev.date);
                  const lt = fmtTime(ev.time_utc, ev.time);
                  const ld = fmtDate(ev.date);
                  const sent = ev.sentiment || guessSentiment(ev);
                  const sentColor = SENT_COLOR[sent] || colors.textSecondary;
                  const isExp = expanded[i] === true;
                  return (
                    <TouchableOpacity key={i} style={[st.eventCard, td && st.eventToday]} onPress={() => toggleExpand(i)} activeOpacity={0.7}>
                      <View style={st.eventMain}>
                        <View style={[st.eventIcon, { backgroundColor: imp.bg }]}><Ionicons name={icon as any} size={15} color={imp.color} /></View>
                        <View style={st.eventContent}>
                          <View style={st.eventTopRow}>
                            <Text style={st.eventName} numberOfLines={1}>{ev.event}</Text>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <View style={[st.sentBadge, { backgroundColor: sentColor + '18' }]}>
                                <Ionicons name={sent === 'bullish' ? 'arrow-up' : sent === 'bearish' ? 'arrow-down' : 'remove'} size={9} color={sentColor} />
                                <Text style={[st.sentTxt, { color: sentColor }]}>{sent.toUpperCase()}</Text>
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
                      {/* Expanded details */}
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

            {/* Earnings */}
            <View style={st.section}>
              <View style={st.secHead}><Ionicons name="bar-chart" size={16} color={colors.blue} /><Text style={st.secTitle}>Big Tech Earnings</Text></View>
              {earnings.length === 0 ? <View style={st.emptyS}><Text style={st.emptySTxt}>No upcoming big tech earnings</Text></View> : (
                earnings.map((e, i) => (
                  <View key={i} style={st.earnCard}>
                    <View style={st.earnLeft}><Text style={st.earnSym}>{e.symbol}</Text><Text style={st.earnDate}>{fmtDate(e.date)}</Text></View>
                    <View style={st.earnRight}>
                      <View style={st.earnRow}><Text style={st.earnLbl}>EPS Est</Text><Text style={st.earnVal}>{e.epsEstimate ? `$${e.epsEstimate.toFixed(2)}` : '-'}</Text></View>
                      <View style={st.earnRow}><Text style={st.earnLbl}>Rev Est</Text><Text style={st.earnVal}>{fmtRev(e.revenueEstimate)}</Text></View>
                    </View>
                    <View style={[st.earnHour, { backgroundColor: e.hour === 'bmo' ? colors.yellowBg : colors.blueBg }]}><Text style={[st.earnHourTxt, { color: e.hour === 'bmo' ? colors.yellow : colors.blue }]}>{e.hour === 'bmo' ? 'Pre-Mkt' : e.hour === 'amc' ? 'After-Hrs' : e.hour || '-'}</Text></View>
                  </View>
                ))
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
  content: { paddingBottom: 30 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { color: colors.green, fontSize: 22, fontWeight: '800' }, title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  dateTxt: { fontSize: 12, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  badge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.blueBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 5, borderWidth: 1, borderColor: 'rgba(10,132,255,0.12)' },
  badgeTxt: { color: colors.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  section: { marginBottom: 24 },
  secHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12, gap: 8 },
  secTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptyS: { marginHorizontal: 20, backgroundColor: colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  emptySTxt: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },
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
