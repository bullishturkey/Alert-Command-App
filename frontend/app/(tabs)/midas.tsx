/**
 * Midas — Automated NDX 0DTE Trading Bot
 * Connects to user's Tastytrade account and places put credit spreads on alert.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch,
  ActivityIndicator, RefreshControl, Alert, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { apiFetch } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { useAppForeground } from '../../hooks/useAppForeground';

// === Midas color palette: deep teal + gold ===
const MIDAS = {
  bg: '#04161A',           // deep teal-black background
  card: '#0A2A2F',         // teal card surface
  cardElev: '#0F3A40',     // elevated teal card
  border: 'rgba(255,210,74,0.15)',  // gold border (subtle)
  borderActive: 'rgba(255,210,74,0.5)',
  teal: '#15D6C6',         // bright teal accent
  tealDim: 'rgba(21,214,198,0.15)',
  gold: '#FFD24A',         // primary gold
  goldDim: 'rgba(255,210,74,0.12)',
  goldDark: '#C99B1E',
  text: '#F1F5F4',
  textDim: '#9FB3B1',
  textMute: '#5C7775',
  ok: '#22C55E',
  warn: '#EF4444',
};

type Trade = {
  id: string;
  underlying?: string;
  price_at_alert?: number;
  short_strike?: number;
  long_strike?: number;
  contracts?: number;
  limit_price?: number;
  account_balance?: number;
  status?: string;
  timestamp?: string;
  order_id?: string;
};

type Status = {
  midas_enabled?: boolean;
  connected?: boolean;
  message?: string;
  account_number?: string;
  account_balance?: number | null;
  limit_price?: number;
  auto_trade?: boolean;
  contracts?: number;
  client_secret_mask?: string;
  refresh_token_mask?: string;
};

export default function MidasScreen() {
  const { isGuest } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [limitDraft, setLimitDraft] = useState('5.00');

  const fetchAll = useCallback(async () => {
    try {
      const [st, tr] = await Promise.allSettled([
        apiFetch('/api/midas/status'),
        apiFetch('/api/midas/trades'),
      ]);
      if (st.status === 'fulfilled') {
        setStatus(st.value);
        if (st.value?.limit_price != null) {
          setLimitDraft(Number(st.value.limit_price).toFixed(2));
        }
      }
      if (tr.status === 'fulfilled') setTrades(tr.value.trades || []);
    } catch (e: any) {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (!isGuest) fetchAll(); else setLoading(false); }, [isGuest, fetchAll]);
  useAppForeground(() => { if (!isGuest) fetchAll(); });

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const handleConnect = async () => {
    if (!clientSecret.trim() || !refreshToken.trim()) {
      Alert.alert('Missing fields', 'Both Client Secret and Refresh Token are required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/midas/connect', {
        method: 'POST',
        body: JSON.stringify({ client_secret: clientSecret.trim(), refresh_token: refreshToken.trim() }),
      });
      setClientSecret('');
      setRefreshToken('');
      Alert.alert('Connected', 'Tastytrade account linked. Loading balance…');
      await fetchAll();
    } catch (e: any) {
      Alert.alert('Connection failed', e?.message || 'Please verify your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect Midas?', 'This removes your Tastytrade credentials and turns off auto-trading.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try {
            await apiFetch('/api/midas/disconnect', { method: 'POST' });
            await fetchAll();
          } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to disconnect'); }
        }
      },
    ]);
  };

  const toggleAutoTrade = async (val: boolean) => {
    // Optimistic
    setStatus(s => s ? { ...s, auto_trade: val } : s);
    try {
      await apiFetch('/api/midas/settings', { method: 'POST', body: JSON.stringify({ auto_trade: val }) });
    } catch (e: any) {
      setStatus(s => s ? { ...s, auto_trade: !val } : s);
      Alert.alert('Error', e?.message || 'Failed to update');
    }
  };

  const saveLimitPrice = async () => {
    const lp = parseFloat(limitDraft);
    if (isNaN(lp) || lp < 0.05 || lp > 100) {
      Alert.alert('Invalid', 'Limit price must be between $0.05 and $100');
      return;
    }
    try {
      await apiFetch('/api/midas/settings', { method: 'POST', body: JSON.stringify({ limit_price: lp }) });
      setStatus(s => s ? { ...s, limit_price: lp } : s);
    } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to update'); }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={MIDAS.gold} size="large" /></View>
      </SafeAreaView>
    );
  }

  // ===== Not whitelisted =====
  if (status && !status.midas_enabled) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <Header />
        <View style={s.center}>
          <View style={[s.card, { alignItems: 'center', maxWidth: 340 }]}>
            <MaterialCommunityIcons name="robot-confused-outline" size={56} color={MIDAS.gold} />
            <Text style={s.cardTitle}>Midas Access Pending</Text>
            <Text style={s.bodyMute}>{status.message || 'Midas access is not enabled on your account. Contact your admin to be added to the trading program.'}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ===== Not connected — show onboarding =====
  if (status && !status.connected) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MIDAS.gold} />}
          >
            <Header />
            <View style={[s.banner, { borderColor: MIDAS.borderActive }]}>
              <MaterialCommunityIcons name="robot-outline" size={38} color={MIDAS.gold} />
              <Text style={s.bannerTitle}>Connect Midas</Text>
              <Text style={s.bannerBody}>Link your Tastytrade brokerage so Midas can auto-place 0DTE NDX put-credit spreads when an alert fires.</Text>
              <View style={s.statusPill}>
                <Ionicons name="close-circle" size={12} color={MIDAS.warn} />
                <Text style={[s.statusTxt, { color: MIDAS.warn }]}>NOT CONNECTED</Text>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.label}>TASTYTRADE CLIENT SECRET</Text>
              <TextInput
                style={s.input}
                placeholder="Paste your OAuth client secret"
                placeholderTextColor={MIDAS.textMute}
                value={clientSecret}
                onChangeText={setClientSecret}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
              />
              <Text style={[s.label, { marginTop: 16 }]}>TASTYTRADE REFRESH TOKEN</Text>
              <TextInput
                style={s.input}
                placeholder="Paste your refresh token"
                placeholderTextColor={MIDAS.textMute}
                value={refreshToken}
                onChangeText={setRefreshToken}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[s.goldBtn, submitting && { opacity: 0.5 }]}
                onPress={handleConnect}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#1A0F00" />
                  : (
                    <>
                      <MaterialCommunityIcons name="link-variant" size={18} color="#1A0F00" />
                      <Text style={s.goldBtnTxt}>CONNECT ACCOUNT</Text>
                    </>
                  )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={s.helpHeader} onPress={() => setShowHelp(!showHelp)} activeOpacity={0.7}>
              <Ionicons name="help-circle-outline" size={20} color={MIDAS.gold} />
              <Text style={s.helpTitle}>How to get these credentials</Text>
              <Ionicons name={showHelp ? 'chevron-up' : 'chevron-down'} size={18} color={MIDAS.gold} />
            </TouchableOpacity>
            {showHelp && (
              <View style={[s.card, { marginTop: 8 }]}>
                <Step n={1} title="Open Tastytrade API Access">
                  <Text style={s.bodyMute}>Go to </Text>
                  <Text style={s.link} onPress={() => Linking.openURL('https://my.tastytrade.com/app.html#/manage/api-access/oauth-applications')}>
                    my.tastytrade.com → API Access → OAuth Applications
                  </Text>
                </Step>
                <Step n={2} title="Create Application">
                  <Text style={s.bodyMute}>Click <Text style={s.bold}>Create Application</Text>. Check ALL scopes. Add this callback URL exactly:</Text>
                  <View style={s.codeBox}><Text style={s.code}>http://localhost:8000</Text></View>
                </Step>
                <Step n={3} title="Copy your Client Secret">
                  <Text style={s.bodyMute}>After creating the app you'll see the Client Secret <Text style={s.bold}>once</Text>. Copy and paste it in the field above.</Text>
                </Step>
                <Step n={4} title="Create a Grant → get Refresh Token">
                  <Text style={s.bodyMute}>Click <Text style={s.bold}>Manage → Create Grant</Text>. Authorize. Copy the Refresh Token shown and paste it above.</Text>
                </Step>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ===== Connected — show dashboard =====
  const balance = status?.account_balance;
  const balanceTxt = balance != null ? `$${Number(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MIDAS.gold} />}
      >
        <Header />

        {/* Connection card */}
        <View style={[s.card, { borderColor: MIDAS.borderActive }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={s.statusPill}>
              <Ionicons name="checkmark-circle" size={12} color={MIDAS.ok} />
              <Text style={[s.statusTxt, { color: MIDAS.ok }]}>CONNECTED</Text>
            </View>
            <TouchableOpacity onPress={handleDisconnect}>
              <Text style={s.disconnect}>Disconnect</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.label, { marginTop: 12 }]}>TASTYTRADE ACCOUNT</Text>
          <Text style={s.bigVal}>{status?.account_number || '—'}</Text>
          <View style={s.row2col}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>BALANCE</Text>
              <Text style={[s.bigVal, { color: MIDAS.teal }]}>{balanceTxt}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>CONTRACTS PER TRADE</Text>
              <Text style={[s.bigVal, { color: MIDAS.gold }]}>{status?.contracts ?? '—'}</Text>
            </View>
          </View>
          <Text style={s.maskTxt}>Client secret {status?.client_secret_mask || ''}</Text>
          <Text style={s.maskTxt}>Refresh token {status?.refresh_token_mask || ''}</Text>
        </View>

        {/* Auto-Trade Toggle */}
        <View style={[s.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Auto-Trade</Text>
            <Text style={s.bodyMute}>Place put-credit spread orders automatically when an alert fires.</Text>
          </View>
          <Switch
            value={!!status?.auto_trade}
            onValueChange={toggleAutoTrade}
            trackColor={{ false: '#2A3D3F', true: MIDAS.goldDim }}
            thumbColor={status?.auto_trade ? MIDAS.gold : '#8EA09E'}
            ios_backgroundColor="#2A3D3F"
          />
        </View>

        {/* Limit Price */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Limit Price</Text>
          <Text style={s.bodyMute}>Net credit per spread (USD).</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: MIDAS.border, borderRadius: 10, paddingHorizontal: 12 }}>
              <Text style={{ color: MIDAS.gold, fontWeight: '700' }}>$</Text>
              <TextInput
                style={[s.input, { borderWidth: 0, flex: 1, paddingHorizontal: 8 }]}
                value={limitDraft}
                onChangeText={setLimitDraft}
                keyboardType="decimal-pad"
                placeholderTextColor={MIDAS.textMute}
              />
            </View>
            <TouchableOpacity style={s.goldBtnSm} onPress={saveLimitPrice}>
              <Text style={s.goldBtnSmTxt}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Position Sizing Rubric */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="scale-balance" size={18} color={MIDAS.gold} />
            <Text style={s.cardTitle}>Position Sizing</Text>
          </View>
          <RubricRow range="Under $7,000" contracts="1" highlight={(balance ?? 0) < 7000} />
          <RubricRow range="$7,000 – $14,999" contracts="2" highlight={(balance ?? 0) >= 7000 && (balance ?? 0) < 15000} />
          <RubricRow range="$15,000 – $19,999" contracts="3" highlight={(balance ?? 0) >= 15000 && (balance ?? 0) < 20000} />
          <RubricRow range="$20,000 – $24,999" contracts="4" highlight={(balance ?? 0) >= 20000 && (balance ?? 0) < 25000} />
          <RubricRow range="+$5,000 per tier" contracts="+1" highlight={(balance ?? 0) >= 25000} />
        </View>

        {/* Trade history */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <MaterialCommunityIcons name="history" size={18} color={MIDAS.gold} />
            <Text style={s.cardTitle}>Trade History</Text>
            <View style={{ flex: 1 }} />
            <Text style={s.bodyMute}>{trades.length} trades</Text>
          </View>
          {trades.length === 0
            ? <Text style={s.bodyMute}>No trades executed yet. Midas will log every spread placement here.</Text>
            : trades.map((t) => <TradeRow key={t.id} t={t} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={s.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={s.logoCircle}>
          <MaterialCommunityIcons name="robot" size={28} color={MIDAS.gold} />
        </View>
        <View>
          <Text style={s.headerTitle}>MIDAS</Text>
          <Text style={s.headerSub}>Automated NDX 0DTE Trading</Text>
        </View>
      </View>
    </View>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <View style={s.stepNum}><Text style={s.stepNumTxt}>{n}</Text></View>
        <Text style={s.stepTitle}>{title}</Text>
      </View>
      <View style={{ paddingLeft: 32 }}>{children}</View>
    </View>
  );
}

function RubricRow({ range, contracts, highlight }: { range: string; contracts: string; highlight?: boolean }) {
  return (
    <View style={[s.rubricRow, highlight && { backgroundColor: MIDAS.goldDim, borderRadius: 8 }]}>
      <Text style={[s.rubricRange, highlight && { color: MIDAS.gold, fontWeight: '700' }]}>{range}</Text>
      <Text style={[s.rubricContracts, highlight && { color: MIDAS.gold }]}>{contracts}</Text>
    </View>
  );
}

function TradeRow({ t }: { t: Trade }) {
  const date = t.timestamp ? new Date(t.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const statusColor = t.status === 'filled' ? MIDAS.ok : t.status === 'failed' ? MIDAS.warn : MIDAS.gold;
  return (
    <View style={s.tradeRow}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.tradeUnderlying}>{t.underlying || 'NDX'}</Text>
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <Text style={[s.tradeStatus, { color: statusColor }]}>{(t.status || 'pending').toUpperCase()}</Text>
          </View>
        </View>
        <Text style={s.tradeStrikes}>
          {t.short_strike ?? '?'} / {t.long_strike ?? '?'} · {t.contracts ?? 0}× @ ${Number(t.limit_price || 0).toFixed(2)}
        </Text>
        <Text style={s.tradeMeta}>Alert ${Number(t.price_at_alert || 0).toFixed(2)} · {date}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MIDAS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: MIDAS.goldDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MIDAS.borderActive },
  headerTitle: { color: MIDAS.gold, fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  headerSub: { color: MIDAS.textDim, fontSize: 11, fontWeight: '600' },

  card: { backgroundColor: MIDAS.card, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: MIDAS.border },
  cardTitle: { color: MIDAS.text, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  banner: { backgroundColor: MIDAS.card, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, alignItems: 'center' },
  bannerTitle: { color: MIDAS.gold, fontSize: 22, fontWeight: '900', marginTop: 10, letterSpacing: 1 },
  bannerBody: { color: MIDAS.textDim, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.3)', alignSelf: 'flex-start', marginTop: 10 },
  statusTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  label: { color: MIDAS.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  bigVal: { color: MIDAS.text, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  row2col: { flexDirection: 'row', gap: 16, marginTop: 12 },
  maskTxt: { color: MIDAS.textMute, fontSize: 11, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  input: { backgroundColor: MIDAS.cardElev, color: MIDAS.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: MIDAS.border },

  goldBtn: { backgroundColor: MIDAS.gold, borderRadius: 10, paddingVertical: 14, marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  goldBtnTxt: { color: '#1A0F00', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  goldBtnSm: { backgroundColor: MIDAS.gold, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  goldBtnSmTxt: { color: '#1A0F00', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  disconnect: { color: MIDAS.warn, fontSize: 12, fontWeight: '700' },

  helpHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: MIDAS.goldDim, borderRadius: 10, marginTop: 8, borderWidth: 1, borderColor: MIDAS.border },
  helpTitle: { color: MIDAS.gold, fontSize: 14, fontWeight: '700', flex: 1 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: MIDAS.gold, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { color: '#1A0F00', fontWeight: '900', fontSize: 12 },
  stepTitle: { color: MIDAS.text, fontWeight: '700', fontSize: 14 },
  bodyMute: { color: MIDAS.textDim, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800', color: MIDAS.text },
  link: { color: MIDAS.teal, textDecorationLine: 'underline', fontSize: 13 },
  codeBox: { backgroundColor: MIDAS.cardElev, borderRadius: 8, padding: 10, marginTop: 6, borderWidth: 1, borderColor: MIDAS.border },
  code: { color: MIDAS.teal, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },

  rubricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  rubricRange: { color: MIDAS.textDim, fontSize: 13 },
  rubricContracts: { color: MIDAS.text, fontSize: 14, fontWeight: '800' },

  tradeRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: MIDAS.border },
  tradeUnderlying: { color: MIDAS.gold, fontSize: 14, fontWeight: '800' },
  tradeStatus: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  tradeStrikes: { color: MIDAS.text, fontSize: 13, marginTop: 4 },
  tradeMeta: { color: MIDAS.textMute, fontSize: 11, marginTop: 2 },
});
