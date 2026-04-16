import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

interface EconomicEvent {
  event: string;
  date: string;
  time_utc?: string;
  time?: string;
  impact: string;
  category: string;
  estimate: string;
  previous: string;
  description: string;
}

interface Earning {
  symbol: string;
  date: string;
  hour: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  summary: string;
  sentiment: string;
  url: string;
  timestamp: string;
}

const IMPACT_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  high: { color: colors.red, bg: colors.redBg, label: 'HIGH' },
  medium: { color: colors.yellow, bg: colors.yellowBg, label: 'MED' },
  low: { color: colors.textSecondary, bg: 'rgba(161,161,170,0.08)', label: 'LOW' },
};

const CATEGORY_ICONS: Record<string, string> = {
  fed: 'business',
  inflation: 'trending-up',
  employment: 'people',
  economic: 'bar-chart',
};

const SENTIMENT_COLORS: Record<string, string> = {
  bullish: colors.green,
  bearish: colors.red,
  neutral: colors.textSecondary,
};

function formatRevenue(val: number | null): string {
  if (!val) return '-';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val}`;
}

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
}

/** Convert UTC ISO string or date string to user's local time */
function formatLocalTime(utcStr?: string, fallbackTime?: string): string {
  if (utcStr) {
    try {
      const d = new Date(utcStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      }
    } catch { /* fallthrough */ }
  }
  return fallbackTime || '';
}

function formatLocalDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function PreflightScreen() {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateStr, setDateStr] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const data = await apiFetch('/api/preflight');
      setEvents(data.economic_events || []);
      setEarnings(data.earnings || []);
      setNews(data.breaking_news || []);
      setDateStr(data.date || '');
    } catch (e) {
      console.error('Preflight fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  const todayFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="preflight-list"
        data={[1]}
        keyExtractor={() => 'preflight'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <View style={styles.headerTitleRow}>
                  <Text style={styles.sectionPrefix}>⟩</Text>
                  <Text style={styles.title}>Preflight</Text>
                </View>
                <Text style={styles.dateText}>{todayFormatted}</Text>
              </View>
              <View style={styles.preflightBadge}>
                <Ionicons name="airplane" size={13} color={colors.blue} />
                <Text style={styles.preflightBadgeText}>DAILY BRIEF</Text>
              </View>
            </View>

            {/* Economic Calendar */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="calendar" size={16} color={colors.yellow} />
                <Text style={styles.sectionTitle}>Economic Calendar</Text>
              </View>

              {events.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>No major economic events this week</Text>
                </View>
              ) : (
                events.map((event, i) => {
                  const impact = IMPACT_COLORS[event.impact] || IMPACT_COLORS.medium;
                  const catIcon = CATEGORY_ICONS[event.category] || 'analytics';
                  const today = isToday(event.date);
                  const localTime = formatLocalTime(event.time_utc, event.time);
                  const localDate = formatLocalDate(event.date);
                  return (
                    <View testID={`econ-event-${i}`} key={i} style={[styles.eventCard, today && styles.eventCardToday]}>
                      <View style={styles.eventLeft}>
                        <View style={[styles.eventIcon, { backgroundColor: impact.bg }]}>
                          <Ionicons name={catIcon as any} size={15} color={impact.color} />
                        </View>
                      </View>
                      <View style={styles.eventContent}>
                        <View style={styles.eventTopRow}>
                          <Text style={styles.eventName} numberOfLines={1}>{event.event}</Text>
                          <View style={[styles.impactBadge, { backgroundColor: impact.bg }]}>
                            <Text style={[styles.impactText, { color: impact.color }]}>{impact.label}</Text>
                          </View>
                        </View>
                        <Text style={styles.eventDescription} numberOfLines={2}>{event.description}</Text>
                        <View style={styles.eventMeta}>
                          <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                          <Text style={styles.eventTime}>{localTime}</Text>
                          <Text style={[styles.eventDateLabel, today && { color: colors.yellow }]}>{today ? 'TODAY' : localDate}</Text>
                          {event.estimate ? <Text style={styles.eventEstimate}>Est: {event.estimate}</Text> : null}
                          {event.previous ? <Text style={styles.eventPrev}>Prev: {event.previous}</Text> : null}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            {/* Earnings */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="bar-chart" size={16} color={colors.blue} />
                <Text style={styles.sectionTitle}>Big Tech Earnings</Text>
              </View>

              {earnings.length === 0 ? (
                <View style={styles.emptySection}>
                  <Text style={styles.emptySectionText}>No upcoming big tech earnings in the next 30 days</Text>
                </View>
              ) : (
                earnings.map((e, i) => (
                  <View testID={`earning-${i}`} key={i} style={styles.earningCard}>
                    <View style={styles.earningLeft}>
                      <Text style={styles.earningSymbol}>{e.symbol}</Text>
                      <Text style={styles.earningDate}>{formatLocalDate(e.date)}</Text>
                    </View>
                    <View style={styles.earningRight}>
                      <View style={styles.earningRow}>
                        <Text style={styles.earningLabel}>EPS Est</Text>
                        <Text style={styles.earningValue}>{e.epsEstimate ? `$${e.epsEstimate.toFixed(2)}` : '-'}</Text>
                      </View>
                      <View style={styles.earningRow}>
                        <Text style={styles.earningLabel}>Rev Est</Text>
                        <Text style={styles.earningValue}>{formatRevenue(e.revenueEstimate)}</Text>
                      </View>
                    </View>
                    <View style={[styles.earningHour, { backgroundColor: e.hour === 'bmo' ? colors.yellowBg : colors.blueBg }]}>
                      <Text style={[styles.earningHourText, { color: e.hour === 'bmo' ? colors.yellow : colors.blue }]}>
                        {e.hour === 'bmo' ? 'Pre-Mkt' : e.hour === 'amc' ? 'After-Hrs' : e.hour || '-'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Breaking News */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="flash" size={16} color={colors.red} />
                <Text style={styles.sectionTitle}>Breaking News</Text>
              </View>

              {news.map((item, i) => {
                const sentColor = SENTIMENT_COLORS[item.sentiment] || colors.textSecondary;
                return (
                  <TouchableOpacity testID={`breaking-news-${i}`} key={item.id} style={styles.newsCard} onPress={() => item.url && Linking.openURL(item.url)} activeOpacity={0.7}>
                    <View style={styles.newsTop}>
                      <Text style={styles.newsSource}>{item.source}</Text>
                      <View style={[styles.sentimentDot, { backgroundColor: sentColor }]} />
                    </View>
                    <Text style={styles.newsHeadline} numberOfLines={2}>{item.headline}</Text>
                    <Text style={styles.newsTime}>{timeAgo(item.timestamp)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  content: { paddingBottom: 30 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionPrefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  dateText: { fontSize: 12, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  preflightBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.blueBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, gap: 5, borderWidth: 1, borderColor: 'rgba(10,132,255,0.12)' },
  preflightBadgeText: { color: colors.blue, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  section: { marginBottom: spacing.xxl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, marginBottom: spacing.md, gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySection: { marginHorizontal: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  emptySectionText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },

  // Economic Events
  eventCard: { backgroundColor: colors.surface, marginHorizontal: spacing.xl, borderRadius: radius.md, padding: 14, marginBottom: spacing.sm, flexDirection: 'row', borderWidth: 1, borderColor: colors.border },
  eventCardToday: { borderColor: 'rgba(255,214,10,0.25)' },
  eventLeft: { marginRight: spacing.md, paddingTop: 2 },
  eventIcon: { width: 34, height: 34, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  eventContent: { flex: 1 },
  eventTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  eventName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  impactBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  impactText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  eventDescription: { color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginBottom: 5 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  eventTime: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  eventDateLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  eventEstimate: { color: colors.blue, fontSize: 10 },
  eventPrev: { color: colors.textMuted, fontSize: 10 },

  // Earnings
  earningCard: { backgroundColor: colors.surface, marginHorizontal: spacing.xl, borderRadius: radius.md, padding: 14, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  earningLeft: { marginRight: spacing.lg },
  earningSymbol: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  earningDate: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  earningRight: { flex: 1, gap: 3 },
  earningRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningLabel: { color: colors.textMuted, fontSize: 11 },
  earningValue: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  earningHour: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  earningHourText: { fontSize: 9, fontWeight: '700' },

  // Breaking News
  newsCard: { backgroundColor: colors.surface, marginHorizontal: spacing.xl, borderRadius: radius.md, padding: 14, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  newsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  newsSource: { color: colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sentimentDot: { width: 7, height: 7, borderRadius: 4 },
  newsHeadline: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  newsTime: { color: colors.textMuted, fontSize: 10, marginTop: 5 },
});
