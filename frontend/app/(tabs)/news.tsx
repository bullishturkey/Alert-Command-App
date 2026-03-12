import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, SectionList, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';

interface EconomicEvent {
  event: string;
  date: string;
  time: string;
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
  high: { color: '#FF5000', bg: 'rgba(255,80,0,0.12)', label: 'HIGH' },
  medium: { color: '#FFD60A', bg: 'rgba(255,214,10,0.12)', label: 'MED' },
  low: { color: '#A1A1AA', bg: 'rgba(161,161,170,0.12)', label: 'LOW' },
};

const CATEGORY_ICONS: Record<string, string> = {
  fed: 'business',
  inflation: 'trending-up',
  employment: 'people',
  economic: 'bar-chart',
};

const SENTIMENT_COLORS: Record<string, string> = {
  bullish: '#00C805',
  bearish: '#FF5000',
  neutral: '#A1A1AA',
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
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  const todayFormatted = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        testID="preflight-list"
        data={[1]}
        keyExtractor={() => 'preflight'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor="#00C805" />}
        showsVerticalScrollIndicator={false}
        renderItem={() => (
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>Preflight</Text>
                <Text style={styles.dateText}>{todayFormatted}</Text>
              </View>
              <View style={styles.preflightBadge}>
                <Ionicons name="airplane" size={14} color="#0A84FF" />
                <Text style={styles.preflightBadgeText}>DAILY BRIEF</Text>
              </View>
            </View>

            {/* Economic Calendar */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="calendar" size={18} color="#FFD60A" />
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
                  return (
                    <View testID={`econ-event-${i}`} key={i} style={[styles.eventCard, today && styles.eventCardToday]}>
                      <View style={styles.eventLeft}>
                        <View style={[styles.eventIcon, { backgroundColor: impact.bg }]}>
                          <Ionicons name={catIcon as any} size={16} color={impact.color} />
                        </View>
                      </View>
                      <View style={styles.eventContent}>
                        <View style={styles.eventTopRow}>
                          <Text style={styles.eventName}>{event.event}</Text>
                          <View style={[styles.impactBadge, { backgroundColor: impact.bg }]}>
                            <Text style={[styles.impactText, { color: impact.color }]}>{impact.label}</Text>
                          </View>
                        </View>
                        <Text style={styles.eventDescription}>{event.description}</Text>
                        <View style={styles.eventMeta}>
                          <Ionicons name="time-outline" size={12} color="#555" />
                          <Text style={styles.eventTime}>{event.time}</Text>
                          <Text style={styles.eventDateLabel}>{today ? 'TODAY' : event.date}</Text>
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
                <Ionicons name="bar-chart" size={18} color="#0A84FF" />
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
                      <Text style={styles.earningDate}>{e.date}</Text>
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
                    <View style={[styles.earningHour, { backgroundColor: e.hour === 'bmo' ? 'rgba(255,214,10,0.12)' : 'rgba(10,132,255,0.12)' }]}>
                      <Text style={[styles.earningHourText, { color: e.hour === 'bmo' ? '#FFD60A' : '#0A84FF' }]}>
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
                <Ionicons name="flash" size={18} color="#FF5000" />
                <Text style={styles.sectionTitle}>Breaking News</Text>
              </View>

              {news.map((item, i) => {
                const sentColor = SENTIMENT_COLORS[item.sentiment] || '#A1A1AA';
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
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  content: { paddingBottom: 30 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  dateText: { fontSize: 13, color: '#555', marginTop: 2 },
  preflightBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(10,132,255,0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, gap: 5 },
  preflightBadgeText: { color: '#0A84FF', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12, gap: 8 },
  sectionTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  emptySection: { marginHorizontal: 20, backgroundColor: '#1C1C1E', borderRadius: 12, padding: 16 },
  emptySectionText: { color: '#555', fontSize: 14, textAlign: 'center' },

  // Economic Events
  eventCard: { backgroundColor: '#1C1C1E', marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row' },
  eventCardToday: { borderWidth: 1, borderColor: 'rgba(255,214,10,0.3)' },
  eventLeft: { marginRight: 12, paddingTop: 2 },
  eventIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  eventContent: { flex: 1 },
  eventTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  eventName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  impactBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  impactText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  eventDescription: { color: '#A1A1AA', fontSize: 12, lineHeight: 16, marginBottom: 6 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventTime: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  eventDateLabel: { color: '#FFD60A', fontSize: 11, fontWeight: '700' },
  eventEstimate: { color: '#0A84FF', fontSize: 11 },
  eventPrev: { color: '#555', fontSize: 11 },

  // Earnings
  earningCard: { backgroundColor: '#1C1C1E', marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  earningLeft: { marginRight: 16 },
  earningSymbol: { color: '#fff', fontSize: 16, fontWeight: '700' },
  earningDate: { color: '#555', fontSize: 11, marginTop: 2 },
  earningRight: { flex: 1, gap: 4 },
  earningRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningLabel: { color: '#555', fontSize: 12 },
  earningValue: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  earningHour: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  earningHourText: { fontSize: 10, fontWeight: '700' },

  // Breaking News
  newsCard: { backgroundColor: '#1C1C1E', marginHorizontal: 20, borderRadius: 12, padding: 14, marginBottom: 8 },
  newsTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  newsSource: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  sentimentDot: { width: 8, height: 8, borderRadius: 4 },
  newsHeadline: { color: '#fff', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  newsTime: { color: '#555', fontSize: 11, marginTop: 6 },
});
