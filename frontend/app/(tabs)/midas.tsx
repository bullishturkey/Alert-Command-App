/**
 * Midas — Automated NDX 0DTE Trading Bot
 * Matches the Alerts Command design language (pure black bg, dark surfaces) with gold accents.
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
import { colors } from '../../theme';

// === Gold accents — everything else matches the existing app palette ===
const GOLD = '#FFD24A';
const GOLD_DIM = 'rgba(255, 210, 74, 0.10)';
const GOLD_DIM_STRONG = 'rgba(255, 210, 74, 0.18)';
const GOLD_BORDER = 'rgba(255, 210, 74, 0.22)';
const GOLD_BORDER_ACTIVE = 'rgba(255, 210, 74, 0.55)';

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
  contracts_auto?: number;
  custom_contracts?: number | null;
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
  const [contractsDraft, setContractsDraft] = useState('');
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [useCustomContracts, setUseCustomContracts] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [st, tr] = await Promise.allSettled([
        apiFetch('/api/midas/status'),
        apiFetch('/api/midas/trades'),
      ]);
      if (st.status === 'fulfilled') {
        setStatus(st.value);
        if (st.value?.limit_price != null) setLimitDraft(Number(st.value.limit_price).toFixed(2));
        if (st.value?.custom_contracts) {
          setUseCustomContracts(true);
          setContractsDraft(String(st.value.custom_contracts));
        } else {
          setUseCustomContracts(false);
          setContractsDraft(String(st.value?.contracts_auto || ''));
        }
      }
      if (tr.status === 'fulfilled') setTrades(tr.value.trades || []);
    } catch {
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

  const saveCustomContracts = async () => {
    if (!useCustomContracts) {
      // User toggled OFF — clear the custom override so the auto rubric kicks in
      try {
        await apiFetch('/api/midas/settings', { method: 'POST', body: JSON.stringify({ custom_contracts: null }) });
        await fetchAll();
      } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to update'); }
      return;
    }
    const c = parseInt(contractsDraft, 10);
    if (isNaN(c) || c < 1 || c > 100) {
      Alert.alert('Invalid', 'Contracts must be between 1 and 100');
      return;
    }
    try {
      await apiFetch('/api/midas/settings', { method: 'POST', body: JSON.stringify({ custom_contracts: c }) });
      setStatus(s => s ? { ...s, custom_contracts: c, contracts: c } : s);
    } catch (e: any) { Alert.alert('Error', e?.message || 'Failed to update'); }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={GOLD} size="large" /></View>
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
            <MaterialCommunityIcons name="robot-confused-outline" size={56} color={GOLD} />
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
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
          >
            <Header />

            <View style={[s.banner]}>
              <View style={s.bannerIcon}>
                <MaterialCommunityIcons name="robot-outline" size={32} color={GOLD} />
              </View>
              <Text style={s.bannerTitle}>Connect Midas</Text>
              <Text style={s.bannerBody}>Link your Tastytrade brokerage so Midas can auto-place 0DTE NDX put-credit spreads when an alert fires.</Text>
              <View style={[s.statusPill, { borderColor: colors.red, backgroundColor: colors.redBg }]}>
                <Ionicons name="close-circle" size={12} color={colors.red} />
                <Text style={[s.statusTxt, { color: colors.red }]}>NOT CONNECTED</Text>
              </View>
            </View>

            <View style={s.card}>
              <Text style={s.label}>TASTYTRADE CLIENT SECRET</Text>
              <TextInput
                style={s.input}
                placeholder="Paste your OAuth client secret"
                placeholderTextColor={colors.textMuted}
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
                placeholderTextColor={colors.textMuted}
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
              <Ionicons name="help-circle-outline" size={20} color={GOLD} />
              <Text style={s.helpTitle}>How to get these credentials</Text>
              <Ionicons name={showHelp ? 'chevron-up' : 'chevron-down'} size={18} color={GOLD} />
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
  const balanceTxt = balance != null
    ? `$${Number(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
      >
        <Header />

        {/* Connection card */}
        <View style={[s.card, { borderColor: GOLD_BORDER_ACTIVE }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={[s.statusPill, { borderColor: colors.green, backgroundColor: colors.greenBg }]}>
              <Ionicons name="checkmark-circle" size={12} color={colors.green} />
              <Text style={[s.statusTxt, { color: colors.green }]}>CONNECTED</Text>
            </View>
            <TouchableOpacity onPress={handleDisconnect}>
              <Text style={s.disconnect}>Disconnect</Text>
            </TouchableOpacity>
          </View>
          <Text style={[s.label, { marginTop: 14 }]}>TASTYTRADE ACCOUNT</Text>
          <Text style={s.bigVal}>{status?.account_number || '—'}</Text>
          <View style={s.row2col}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.label}>BALANCE</Text>
                <TouchableOpacity onPress={() => setBalanceHidden(h => !h)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={balanceHidden ? 'eye-off-outline' : 'eye-outline'} size={14} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
              <Text style={[s.bigVal, { color: colors.green }]}>
                {balanceHidden ? '••••••' : balanceTxt}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>CONTRACTS / TRADE</Text>
              <Text style={[s.bigVal, { color: GOLD }]}>{status?.contracts ?? '—'}</Text>
              {status?.custom_contracts ? (
                <Text style={{ color: GOLD, fontSize: 10, fontWeight: '700', marginTop: -2 }}>CUSTOM</Text>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: -2 }}>Auto from rubric</Text>
              )}
            </View>
          </View>
          <View style={s.maskBox}>
            <Text style={s.maskTxt}>Client secret  {status?.client_secret_mask || ''}</Text>
            <Text style={s.maskTxt}>Refresh token  {status?.refresh_token_mask || ''}</Text>
          </View>
        </View>

        {/* Auto-Trade Toggle */}
        <View style={[s.card, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.cardTitle}>Auto-Trade</Text>
            <Text style={s.bodyMute}>Place put-credit spread orders automatically when an alert fires.</Text>
          </View>
          <Switch
            value={!!status?.auto_trade}
            onValueChange={toggleAutoTrade}
            trackColor={{ false: colors.border, true: GOLD_DIM_STRONG }}
            thumbColor={status?.auto_trade ? GOLD : colors.textTertiary}
            ios_backgroundColor={colors.border}
          />
        </View>

        {/* Limit Price */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Limit Price</Text>
          <Text style={s.bodyMute}>Net credit per spread (USD).</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <View style={s.inputPill}>
              <Text style={{ color: GOLD, fontWeight: '700' }}>$</Text>
              <TextInput
                style={s.inputInline}
                value={limitDraft}
                onChangeText={setLimitDraft}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <TouchableOpacity style={s.goldBtnSm} onPress={saveLimitPrice}>
              <Text style={s.goldBtnSmTxt}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Custom Contract Override */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.cardTitle}>Override Contracts</Text>
              <Text style={s.bodyMute}>
                {useCustomContracts
                  ? `Manual: ${status?.custom_contracts || contractsDraft || '—'} contracts per trade.`
                  : `Following the position-sizing rubric below (auto: ${status?.contracts_auto ?? '—'}).`}
              </Text>
            </View>
            <Switch
              value={useCustomContracts}
              onValueChange={(v) => {
                setUseCustomContracts(v);
                if (!v) {
                  // Immediately clear server-side override
                  apiFetch('/api/midas/settings', { method: 'POST', body: JSON.stringify({ custom_contracts: null }) })
                    .then(fetchAll).catch(() => null);
                }
              }}
              trackColor={{ false: colors.border, true: 'rgba(255,210,74,0.18)' }}
              thumbColor={useCustomContracts ? GOLD : colors.textTertiary}
              ios_backgroundColor={colors.border}
            />
          </View>
          {useCustomContracts && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <View style={s.inputPill}>
                <Ionicons name="layers-outline" size={16} color={GOLD} style={{ marginRight: 6 }} />
                <TextInput
                  style={s.inputInline}
                  value={contractsDraft}
                  onChangeText={setContractsDraft}
                  keyboardType="number-pad"
                  placeholder="e.g. 2"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                />
              </View>
              <TouchableOpacity style={s.goldBtnSm} onPress={saveCustomContracts}>
                <Text style={s.goldBtnSmTxt}>SAVE</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Position Sizing Rubric */}
        <View style={s.card}>
          <View style={s.cardHeadRow}>
            <MaterialCommunityIcons name="scale-balance" size={16} color={GOLD} />
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
          <View style={s.cardHeadRow}>
            <MaterialCommunityIcons name="history" size={16} color={GOLD} />
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
      <View style={s.logoCircle}>
        <MaterialCommunityIcons name="robot" size={22} color={GOLD} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle}>MIDAS</Text>
        <Text style={s.headerSub}>Automated NDX 0DTE Trading</Text>
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
    <View style={[s.rubricRow, highlight && s.rubricRowActive]}>
      <Text style={[s.rubricRange, highlight && { color: GOLD, fontWeight: '700' }]}>{range}</Text>
      <Text style={[s.rubricContracts, highlight && { color: GOLD }]}>{contracts}</Text>
    </View>
  );
}

function TradeRow({ t }: { t: Trade }) {
  const date = t.timestamp
    ? new Date(t.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  const st = (t.status || 'pending').toLowerCase();
  const statusColor = st === 'filled' ? colors.green : st === 'failed' ? colors.red : GOLD;
  const statusBg = st === 'filled' ? colors.greenBg : st === 'failed' ? colors.redBg : GOLD_DIM;
  return (
    <View style={s.tradeRow}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.tradeUnderlying}>{t.underlying || 'NDX'}</Text>
          <View style={[s.tradeStatusPill, { backgroundColor: statusBg, borderColor: statusColor }]}>
            <Text style={[s.tradeStatusTxt, { color: statusColor }]}>{st.toUpperCase()}</Text>
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
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },

  header: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: GOLD_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GOLD_BORDER },
  headerTitle: { color: GOLD, fontSize: 20, fontWeight: '900', letterSpacing: 3 },
  headerSub: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

  // Card — matches the rest of the app: dark surface, subtle border
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },

  banner: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: GOLD_BORDER, alignItems: 'center' },
  bannerIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: GOLD_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GOLD_BORDER, marginBottom: 12 },
  bannerTitle: { color: GOLD, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  bannerBody: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, alignSelf: 'flex-start', marginTop: 12 },
  statusTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  label: { color: colors.textTertiary, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  bigVal: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 2 },
  row2col: { flexDirection: 'row', gap: 16, marginTop: 14 },

  maskBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  maskTxt: { color: colors.textTertiary, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },

  // Inputs — match alerts/admin pages
  input: { backgroundColor: colors.surfaceElevated, color: colors.textPrimary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  inputPill: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  inputInline: { flex: 1, color: colors.textPrimary, paddingHorizontal: 8, paddingVertical: 12, fontSize: 14 },

  // Buttons — gold accent
  goldBtn: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 14, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  goldBtnTxt: { color: '#1A0F00', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  goldBtnSm: { backgroundColor: GOLD, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 },
  goldBtnSmTxt: { color: '#1A0F00', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  disconnect: { color: colors.red, fontSize: 12, fontWeight: '700' },

  // Help section
  helpHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: GOLD_DIM, borderRadius: 10, marginTop: 4, borderWidth: 1, borderColor: GOLD_BORDER },
  helpTitle: { color: GOLD, fontSize: 14, fontWeight: '700', flex: 1 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { color: '#1A0F00', fontWeight: '900', fontSize: 12 },
  stepTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  bodyMute: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '800', color: colors.textPrimary },
  link: { color: GOLD, textDecorationLine: 'underline', fontSize: 13 },
  codeBox: { backgroundColor: colors.surfaceElevated, borderRadius: 8, padding: 10, marginTop: 6, borderWidth: 1, borderColor: colors.border },
  code: { color: GOLD, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },

  // Rubric rows
  rubricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 },
  rubricRowActive: { backgroundColor: GOLD_DIM, borderWidth: 1, borderColor: GOLD_BORDER },
  rubricRange: { color: colors.textSecondary, fontSize: 13 },
  rubricContracts: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },

  // Trade history rows
  tradeRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
  tradeUnderlying: { color: GOLD, fontSize: 14, fontWeight: '800' },
  tradeStatusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  tradeStatusTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  tradeStrikes: { color: colors.textPrimary, fontSize: 13, marginTop: 4 },
  tradeMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
});
