import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

const SUPPORT_EMAIL = 'support@alertscommand.com';

const FAQS = [
  {
    q: 'What is Alerts Command?',
    a: 'Alerts Command is an independent, third-party trading intelligence app that provides real-time market data, trade alerts, AI-powered sentiment analysis, and educational content for Nasdaq-100 traders. We are NOT affiliated with, endorsed by, or connected to Nasdaq, Inc. or any stock exchange.',
  },
  {
    q: 'Is Alerts Command free to use?',
    a: 'Yes. Alerts Command is 100% free. There are no in-app purchases, subscriptions, or paywalls. We do not sell your data.',
  },
  {
    q: 'How do I receive push notifications?',
    a: 'Create an account, then enable push notifications in the Settings tab. You\'ll receive real-time trade alerts directly to your device.',
  },
  {
    q: 'Is the market data real-time?',
    a: 'We source data from Finnhub and Yahoo Finance. Most data is near real-time, though some may have a brief delay depending on the data provider.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. Alerts Command is an informational tool only. All market data, AI analysis, and alerts are for educational purposes. Always consult a licensed financial advisor before making investment decisions.',
  },
  {
    q: 'How do I delete my account?',
    a: 'Go to Settings in the app and tap "Delete My Account." This will permanently remove your account and all associated data including watchlists and push notification tokens.',
  },
  {
    q: 'Can I use the app without an account?',
    a: 'Yes. You can browse market data, charts, and news as a guest. An account is only needed to receive personalized alerts and manage a custom watchlist.',
  },
  {
    q: 'How long does support take to respond?',
    a: 'We typically respond to support emails within 24–48 hours.',
  },
];

export default function SupportPage() {
  const router = useRouter();

  const handleEmailPress = () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=Alerts%20Command%20Support`;
    if (Platform.OS === 'web') {
      // On web, open in a new tab/window to avoid navigation errors
      if (typeof window !== 'undefined') window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

  const canGoBack = Platform.OS !== 'web';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false, title: 'Support' }} />

      {/* Header */}
      <View style={styles.header}>
        {canGoBack && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Support Center</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoBadge}>
            <Ionicons name="help-circle" size={28} color={colors.green} />
          </View>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSubtitle}>
            Alerts Command — Trading Intelligence Platform
          </Text>
        </View>

        {/* Contact card */}
        <TouchableOpacity style={styles.contactCard} onPress={handleEmailPress} activeOpacity={0.8}>
          <View style={styles.contactIcon}>
            <Ionicons name="mail" size={22} color={colors.green} />
          </View>
          <View style={styles.contactBody}>
            <Text style={styles.contactLabel}>Contact Support</Text>
            <Text style={styles.contactEmail}>{SUPPORT_EMAIL}</Text>
            <Text style={styles.contactMeta}>We respond within 24–48 hours</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* FAQs */}
        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        {FAQS.map((faq, idx) => (
          <View key={idx} style={styles.faqCard}>
            <Text style={styles.faqQuestion}>{faq.q}</Text>
            <Text style={styles.faqAnswer}>{faq.a}</Text>
          </View>
        ))}

        {/* App info */}
        <Text style={styles.sectionTitle}>App Information</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>1.1.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Platform</Text>
            <Text style={styles.infoValue}>iOS / iPadOS</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Category</Text>
            <Text style={styles.infoValue}>Finance</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Price</Text>
            <Text style={[styles.infoValue, { color: colors.green }]}>Free</Text>
          </View>
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimerBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
          <Text style={styles.disclaimerText}>
            Alerts Command is an independent application and is not affiliated with, endorsed by, or connected to Nasdaq, Inc. or any stock exchange. All trademarks belong to their respective owners. All content is informational only and does not constitute financial advice.
          </Text>
        </View>

        <Text style={styles.footer}>© 2026 Alerts Command. All rights reserved.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 16,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  heroSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 14,
    padding: 16,
    marginBottom: 28,
    gap: 14,
  },
  contactIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.greenBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactBody: {
    flex: 1,
  },
  contactLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  contactEmail: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  contactMeta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sectionTitle: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 8,
  },
  faqCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  faqQuestion: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  faqAnswer: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  infoLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  infoValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  disclaimerBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  disclaimerText: {
    flex: 1,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  footer: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});
