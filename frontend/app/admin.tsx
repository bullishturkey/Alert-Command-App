import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ScrollView, ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';
import { colors } from '../theme';

export default function AdminScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({ users: 0, alerts: 0, messages: 0 });
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [discord, setDiscord] = useState<any>(null);
  const [importStatus, setImportStatus] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [midasMap, setMidasMap] = useState<Record<string, any>>({});
  const [detailUser, setDetailUser] = useState<any | null>(null);
  const [discordDraft, setDiscordDraft] = useState('');
  const [savingDiscord, setSavingDiscord] = useState(false);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openUserDetail = (u: any) => {
    setDetailUser(u);
    setDiscordDraft(midasMap[u.id]?.discord_id || '');
  };

  const saveDiscordLink = async () => {
    if (!detailUser) return;
    setSavingDiscord(true);
    try {
      await apiFetch('/api/admin/midas/link-discord', {
        method: 'POST',
        body: JSON.stringify({
          user_id: detailUser.id,
          discord_id: discordDraft.trim(),
          display_name: detailUser.username || '',
        }),
      });
      setMidasMap(prev => ({
        ...prev,
        [detailUser.id]: { ...(prev[detailUser.id] || {}), discord_id: discordDraft.trim() },
      }));
      Alert.alert('Saved', discordDraft.trim() ? `Discord ID ${discordDraft.trim()} linked.` : 'Discord ID unlinked.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save Discord link');
    } finally {
      setSavingDiscord(false);
    }
  };

  const toggleMidasAccess = async (u: any) => {
    const current = midasMap[u.id]?.enabled || false;
    const next = !current;
    // optimistic update
    setMidasMap(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || {}), enabled: next, connected: prev[u.id]?.connected || false, auto_trade: prev[u.id]?.auto_trade || false } }));
    try {
      await apiFetch('/api/admin/midas/toggle-access', {
        method: 'POST',
        body: JSON.stringify({ user_id: u.id, enabled: next }),
      });
    } catch (e: any) {
      // rollback
      setMidasMap(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || {}), enabled: current } }));
      Alert.alert('Error', e?.message || 'Failed to toggle Midas access');
    }
  };

  // Alert form
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertTicker, setAlertTicker] = useState('');
  const [alertType, setAlertType] = useState('info');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Use allSettled so a single slow/failed call doesn't blow away the whole panel
      const results = await Promise.allSettled([
        apiFetch('/api/admin/stats'),
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/discord/status'),
        apiFetch('/api/admin/discord/import-status'),
        apiFetch('/api/admin/midas/users'),
      ]);
      const [statsRes, usersRes, discordRes, importRes, midasRes] = results;
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.users || []);
      if (discordRes.status === 'fulfilled') setDiscord(discordRes.value);
      if (importRes.status === 'fulfilled') setImportStatus(importRes.value);
      if (midasRes.status === 'fulfilled') {
        const map: Record<string, any> = {};
        (midasRes.value.users || []).forEach((u: any) => {
          map[u.id] = {
            enabled: !!u.midas_enabled,
            connected: !!u.connected,
            auto_trade: !!u.auto_trade,
            discord_id: u.discord_id || '',
            discord_display_name: u.discord_display_name || '',
            account_number: u.account_number || '',
            account_balance: u.account_balance,
            limit_price: u.limit_price,
            client_secret_mask: u.client_secret_mask || '',
            refresh_token_mask: u.refresh_token_mask || '',
            connected_at: u.connected_at || '',
          };
        });
        setMidasMap(map);
      }
    } catch (e) {
      console.error('Admin fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const startImport = async () => {
    Alert.alert(
      'Import Discord History',
      'This will import all alerts from the past 2 years from your Discord channel. This may take a few minutes. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import', onPress: async () => {
            setImporting(true);
            try {
              await apiFetch('/api/admin/discord/import-history', { method: 'POST' });
              // Poll for progress every 3s
              importPollRef.current = setInterval(async () => {
                try {
                  const status = await apiFetch('/api/admin/discord/import-status');
                  setImportStatus(status);
                  if (!status.running) {
                    clearInterval(importPollRef.current!);
                    setImporting(false);
                    fetchData(); // refresh stats
                  }
                } catch { /* ignore */ }
              }, 3000);
            } catch (e: any) {
              Alert.alert('Error', e.message);
              setImporting(false);
            }
          }
        }
      ]
    );
  };

  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyingNdx, setReclassifyingNdx] = useState(false);
  const [refreshingAI, setRefreshingAI] = useState(false);

  const reclassifyAlerts = async () => {
    Alert.alert(
      'Re-classify Alert Colors',
      'This will re-scan all alerts for green/red emojis and update their WIN/LOSS color. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Re-classify', onPress: async () => {
          setReclassifying(true);
          try {
            const res = await apiFetch('/api/admin/reclassify-alerts', { method: 'POST' });
            Alert.alert('Done', res.message || `Updated ${res.updated} alerts.`);
            fetchData();
          } catch (e: any) { Alert.alert('Error', e.message); }
          finally { setReclassifying(false); }
        }}
      ]
    );
  };

  const reclassifyByNdxClose = async () => {
    Alert.alert(
      'Reclassify by NDX Daily Close',
      'This compares each alert\'s price to the NDX daily close that day.\n\n• Close ABOVE alert price → 🟢 Bullish\n• Close BELOW alert price → 🔴 Bearish\n\nThis will update ALL historical alerts. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', style: 'destructive', onPress: async () => {
          setReclassifyingNdx(true);
          try {
            const res = await apiFetch('/api/admin/reclassify-by-ndx-close', { method: 'POST' });
            Alert.alert('Done ✅', res.message || `Updated ${res.updated} alerts.`);
            fetchData();
          } catch (e: any) { Alert.alert('Error', e.message); }
          finally { setReclassifyingNdx(false); }
        }}
      ]
    );
  };

  const forceRefreshAI = async () => {
    Alert.alert(
      'Force Refresh AI Sentiment',
      'This will generate fresh AI market analysis now (takes ~20s). All users will receive the updated analysis. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refresh', onPress: async () => {
          setRefreshingAI(true);
          try {
            const res = await apiFetch('/api/admin/refresh-sentiment', { method: 'POST' });
            Alert.alert('Done', res.message || 'AI sentiment refreshed.');
          } catch (e: any) { Alert.alert('Error', e.message); }
          finally { setRefreshingAI(false); }
        }}
      ]
    );
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const sendAlert = async () => {
    if (!alertTitle || !alertMessage) {
      Alert.alert('Error', 'Title and message are required');
      return;
    }
    setSending(true);
    try {
      await apiFetch('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({ title: alertTitle, message: alertMessage, ticker: alertTicker, type: alertType, severity: 'high' }),
      });
      Alert.alert('Success', 'Alert sent to all users');
      setAlertTitle('');
      setAlertMessage('');
      setAlertTicker('');
      fetchData();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSending(false);
    }
  };

  if (!user?.is_admin) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="shield-outline" size={48} color="#FF5000" />
          <Text style={styles.accessDenied}>Admin Access Required</Text>
          <TouchableOpacity testID="admin-back-btn" style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const revokeUser = async (u: any) => {
    Alert.alert(
      'Revoke Access',
      `Block ${u.username || u.email}? Their session will be forcibly logged out on next API call.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: async () => {
          try {
            await apiFetch(`/api/admin/users/${u.id}/revoke`, { method: 'POST' });
            fetchData();
          } catch (e: any) { Alert.alert('Error', e.message); }
        }}
      ]
    );
  };

  const reinstateUser = async (u: any) => {
    try {
      await apiFetch(`/api/admin/users/${u.id}/restore`, { method: 'POST' });
      fetchData();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.green} /></View>;
  }

  const TYPES = ['info', 'bullish', 'bearish', 'neutral'];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header with back button */}
      <View style={styles.pageHeader}>
        <TouchableOpacity testID="admin-back-btn-top" style={styles.headerBackBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          <Text style={styles.headerBackLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Admin Panel</Text>
        <View style={styles.headerBackBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Discord bot status card */}
        {discord && (
          <View style={styles.discordCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[
                styles.discordDot,
                { backgroundColor: !discord.enabled ? '#404048' : discord.connected ? colors.green : colors.red },
              ]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.discordTitle}>
                  Discord Bot {!discord.enabled ? '— Not Configured' : discord.connected ? '— Connected' : '— Disconnected'}
                </Text>
                <Text style={styles.discordMeta} numberOfLines={1}>
                  {!discord.enabled
                    ? 'Set DISCORD_BOT_TOKEN + DISCORD_ALERTS_CHANNEL_ID in backend env'
                    : discord.connected
                      ? `Forwarded: ${discord.total_forwarded || 0} · As ${discord.bot_username || '—'}`
                      : `Last error: ${(discord.last_error || 'unknown').toString().slice(0, 60)}`}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Discord History Import */}
        <View style={styles.importCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
            <Ionicons name="cloud-download-outline" size={18} color={colors.green} />
            <Text style={styles.sectionTitle}>Import Discord History</Text>
          </View>
          {importStatus && importStatus.status !== 'idle' && (
            <View style={styles.importStatus}>
              <Text style={[styles.importStatusLabel, { color: importStatus.status === 'error' ? colors.red : importStatus.status === 'done' ? colors.green : '#FFD60A' }]}>
                {importStatus.status === 'running' ? `Importing… ${importStatus.imported} alerts imported` :
                 importStatus.status === 'done' ? `Done! ${importStatus.imported} alerts imported, ${importStatus.skipped} skipped` :
                 importStatus.status === 'error' ? `Error: ${importStatus.error?.slice(0, 80)}` : ''}
              </Text>
              {importStatus.status === 'running' && (
                <Text style={styles.importSubLabel}>Fetched {importStatus.total_fetched} messages so far…</Text>
              )}
            </View>
          )}
          <TouchableOpacity
            style={[styles.importBtn, importing && { opacity: 0.6 }]}
            onPress={startImport}
            disabled={importing}
          >
            {importing
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.importBtnText}>Import Last 2 Years from Discord</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Re-classify alert colors + Force AI refresh + NDX-close reclassify */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <TouchableOpacity
            style={[styles.toolBtn, { flex: 1, borderColor: '#FFD60A', backgroundColor: 'rgba(255,214,10,0.08)' }, reclassifying && { opacity: 0.6 }]}
            onPress={reclassifyAlerts}
            disabled={reclassifying}
          >
            {reclassifying
              ? <ActivityIndicator color="#FFD60A" size="small" />
              : <>
                  <Ionicons name="color-palette-outline" size={16} color="#FFD60A" />
                  <Text style={[styles.toolBtnTxt, { color: '#FFD60A' }]}>Re-classify{'\n'}Alert Colors</Text>
                </>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { flex: 1, borderColor: colors.blue, backgroundColor: colors.blueBg }, refreshingAI && { opacity: 0.6 }]}
            onPress={forceRefreshAI}
            disabled={refreshingAI}
          >
            {refreshingAI
              ? <ActivityIndicator color={colors.blue} size="small" />
              : <>
                  <Ionicons name="sparkles-outline" size={16} color={colors.blue} />
                  <Text style={[styles.toolBtnTxt, { color: colors.blue }]}>Force Refresh{'\n'}AI Sentiment</Text>
                </>
            }
          </TouchableOpacity>
        </View>

        {/* NDX Close reclassify — most accurate historical color fix */}
        <TouchableOpacity
          style={[styles.toolBtn, { borderColor: '#FF9500', backgroundColor: 'rgba(255,149,0,0.08)', marginBottom: 16, flexDirection: 'row', gap: 10, paddingVertical: 14 }, reclassifyingNdx && { opacity: 0.6 }]}
          onPress={reclassifyByNdxClose}
          disabled={reclassifyingNdx}
        >
          {reclassifyingNdx
            ? <><ActivityIndicator color="#FF9500" size="small" /><Text style={[styles.toolBtnTxt, { color: '#FF9500' }]}>Fetching NDX data &amp; updating...</Text></>
            : <>
                <Ionicons name="analytics-outline" size={18} color="#FF9500" />
                <Text style={[styles.toolBtnTxt, { color: '#FF9500', textAlign: 'left' }]}>
                  Reclassify by NDX Daily Close{'\n'}
                  <Text style={{ fontSize: 11, opacity: 0.85, color: '#FF9500' }}>Green if close &gt; alert price · Red if close &lt; alert price</Text>
                </Text>
              </>
          }
        </TouchableOpacity>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{stats.users}</Text>
            <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>Users</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{stats.alerts}</Text>
            <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{stats.messages}</Text>
            <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>Messages</Text>
          </View>
        </View>

        {/* Create Alert */}
        <Text style={styles.sectionTitle}>Create Alert</Text>
        <View style={styles.formCard}>
          <TextInput testID="admin-alert-title" style={styles.formInput} placeholder="Alert Title" placeholderTextColor="#555" value={alertTitle} onChangeText={setAlertTitle} />
          <TextInput testID="admin-alert-message" style={[styles.formInput, styles.textArea]} placeholder="Alert Message" placeholderTextColor="#555" value={alertMessage} onChangeText={setAlertMessage} multiline numberOfLines={3} />
          <TextInput testID="admin-alert-ticker" style={styles.formInput} placeholder="Ticker (optional)" placeholderTextColor="#555" value={alertTicker} onChangeText={setAlertTicker} autoCapitalize="characters" />

          <View style={styles.typeRow}>
            {TYPES.map(t => (
              <TouchableOpacity testID={`admin-type-${t}`} key={t} style={[styles.typePill, alertType === t && styles.typePillActive]} onPress={() => setAlertType(t)}>
                <Text style={[styles.typeText, alertType === t && styles.typeTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity testID="admin-send-alert-btn" style={[styles.sendAlertBtn, sending && styles.sendAlertBtnDisabled]} onPress={sendAlert} disabled={sending}>
            {sending ? <ActivityIndicator color="#000" /> : <Text style={styles.sendAlertBtnText}>Send Alert</Text>}
          </TouchableOpacity>
        </View>

        {/* Users */}
        <Text style={styles.sectionTitle}>Users ({users.length})</Text>
        {users.map(u => {
          const revoked = !!u.is_revoked;
          const m = midasMap[u.id] || {};
          return (
            <TouchableOpacity
              key={u.id}
              activeOpacity={0.7}
              onPress={() => openUserDetail(u)}
              style={[styles.userCard, revoked && { opacity: 0.7, borderWidth: 1, borderColor: colors.red + '66' }]}
            >
              <View style={styles.userInfo}>
                <View style={[styles.avatarBadge, u.is_admin && styles.avatarBadgeAdmin]}>
                  <Text style={styles.avatarText}>{u.username?.charAt(0)?.toUpperCase() || '?'}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.userName} numberOfLines={1}>{u.username}</Text>
                    {u.is_admin && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>Admin</Text></View>}
                    {revoked && <View style={{ backgroundColor: colors.redBgStrong, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}><Text style={{ color: colors.red, fontSize: 10, fontWeight: '700' }}>REVOKED</Text></View>}
                    {m.discord_id ? (
                      <View style={{ backgroundColor: 'rgba(88,101,242,0.18)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ color: '#a5b4fc', fontSize: 9, fontWeight: '700' }}>🎮 {m.discord_id.slice(-6)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="tail">{u.email}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* User Detail Modal */}
      <Modal
        visible={!!detailUser}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDetailUser(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={dmStyles.header}>
              <TouchableOpacity onPress={() => setDetailUser(null)}><Ionicons name="close" size={24} color="#fff" /></TouchableOpacity>
              <Text style={dmStyles.headerTitle}>User Details</Text>
              <View style={{ width: 24 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {detailUser && (() => {
                const m = midasMap[detailUser.id] || {};
                return (
                  <>
                    {/* Avatar header */}
                    <View style={{ alignItems: 'center', marginBottom: 20 }}>
                      <View style={[styles.avatarBadge, { width: 72, height: 72, borderRadius: 36 }, detailUser.is_admin && styles.avatarBadgeAdmin]}>
                        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{detailUser.username?.charAt(0)?.toUpperCase() || '?'}</Text>
                      </View>
                      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 10 }}>{detailUser.username}</Text>
                      <Text style={{ color: '#9CA3AF', fontSize: 13 }}>{detailUser.email}</Text>
                      {detailUser.is_admin && <View style={[styles.adminBadge, { marginTop: 6 }]}><Text style={styles.adminBadgeText}>Admin</Text></View>}
                    </View>

                    {/* Account section */}
                    <Text style={dmStyles.sectionLabel}>Account</Text>
                    <Row label="User ID" value={detailUser.id} mono />
                    <Row label="Email" value={detailUser.email} />
                    <Row label="Username" value={detailUser.username} />
                    <Row label="Created" value={detailUser.created_at ? new Date(detailUser.created_at).toLocaleString() : '—'} />
                    <Row label="Status" value={detailUser.is_revoked ? 'Revoked' : 'Active'} valueColor={detailUser.is_revoked ? colors.red : colors.green} />

                    {/* Discord section */}
                    <Text style={dmStyles.sectionLabel}>Discord Link</Text>
                    <Text style={dmStyles.helpTxt}>Link this user's app account to their Discord ID so the Midas bot can match alerts to their Tastytrade account.</Text>
                    <View style={{ marginTop: 10 }}>
                      <Text style={dmStyles.inputLabel}>DISCORD ID</Text>
                      <TextInput
                        style={dmStyles.input}
                        placeholder="e.g. 123456789012345678"
                        placeholderTextColor="#555"
                        value={discordDraft}
                        onChangeText={setDiscordDraft}
                        keyboardType="numeric"
                        autoCorrect={false}
                      />
                      {m.discord_display_name ? (
                        <Text style={[dmStyles.helpTxt, { marginTop: 6 }]}>Display name on Discord: <Text style={{ color: '#fff', fontWeight: '600' }}>{m.discord_display_name}</Text></Text>
                      ) : null}
                      <TouchableOpacity
                        style={[dmStyles.saveBtn, savingDiscord && { opacity: 0.5 }]}
                        onPress={saveDiscordLink}
                        disabled={savingDiscord}
                      >
                        {savingDiscord
                          ? <ActivityIndicator color="#000" />
                          : <Text style={dmStyles.saveBtnTxt}>{discordDraft.trim() ? 'SAVE DISCORD LINK' : 'UNLINK DISCORD'}</Text>}
                      </TouchableOpacity>
                    </View>

                    {/* Midas section */}
                    <Text style={dmStyles.sectionLabel}>Midas</Text>
                    <Row label="Access Enabled" value={m.enabled ? 'Yes' : 'No'} valueColor={m.enabled ? '#FFD24A' : '#9CA3AF'} />
                    <Row label="Tastytrade Connected" value={m.connected ? 'Yes' : 'No'} valueColor={m.connected ? colors.green : '#9CA3AF'} />
                    <Row label="Auto-Trade" value={m.auto_trade ? 'ON' : 'OFF'} valueColor={m.auto_trade ? '#FFD24A' : '#9CA3AF'} />
                    <Row label="Account #" value={m.account_number || '—'} mono />
                    <Row label="Balance" value={m.account_balance != null ? `$${Number(m.account_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} />
                    <Row label="Limit Price" value={`$${Number(m.limit_price || 5).toFixed(2)}`} />
                    <Row label="Client Secret" value={m.client_secret_mask || '—'} mono />
                    <Row label="Refresh Token" value={m.refresh_token_mask || '—'} mono />
                    <Row label="Connected At" value={m.connected_at ? new Date(m.connected_at).toLocaleString() : '—'} />

                    {/* Actions */}
                    {!detailUser.is_admin && (
                      <View style={{ marginTop: 20, gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => toggleMidasAccess(detailUser)}
                          style={[dmStyles.actionBtn, { backgroundColor: m.enabled ? 'rgba(255,210,74,0.18)' : 'rgba(255,210,74,0.06)', borderColor: '#FFD24A' }]}
                        >
                          <Ionicons name={m.enabled ? 'sparkles' : 'sparkles-outline'} size={16} color="#FFD24A" />
                          <Text style={[dmStyles.actionBtnTxt, { color: '#FFD24A' }]}>{m.enabled ? 'Disable Midas Access' : 'Enable Midas Access'}</Text>
                        </TouchableOpacity>
                        {detailUser.is_revoked ? (
                          <TouchableOpacity
                            onPress={() => { reinstateUser(detailUser); setDetailUser(null); }}
                            style={[dmStyles.actionBtn, { backgroundColor: colors.greenBg, borderColor: colors.green }]}
                          >
                            <Ionicons name="checkmark-circle" size={16} color={colors.green} />
                            <Text style={[dmStyles.actionBtnTxt, { color: colors.green }]}>Reinstate Account</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            onPress={() => { revokeUser(detailUser); setDetailUser(null); }}
                            style={[dmStyles.actionBtn, { backgroundColor: colors.redBg, borderColor: colors.red }]}
                          >
                            <Ionicons name="close-circle" size={16} color={colors.red} />
                            <Text style={[dmStyles.actionBtnTxt, { color: colors.red }]}>Revoke Account</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </>
                );
              })()}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, valueColor, mono }: { label: string; value: string; valueColor?: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', gap: 12 }}>
      <Text style={{ color: '#9CA3AF', fontSize: 12, fontWeight: '600', flex: 1 }}>{label}</Text>
      <Text
        selectable
        style={{ color: valueColor || '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right', fontFamily: mono ? (Platform.OS === 'ios' ? 'Menlo' : 'monospace') : undefined }}
      >{value}</Text>
    </View>
  );
}

const dmStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sectionLabel: { color: '#FFD24A', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 22, marginBottom: 8 },
  helpTxt: { color: '#9CA3AF', fontSize: 12, lineHeight: 17 },
  inputLabel: { color: '#9CA3AF', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  input: { backgroundColor: '#141416', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#1C1C20', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  saveBtn: { backgroundColor: '#FFD24A', borderRadius: 10, paddingVertical: 13, marginTop: 12, alignItems: 'center' },
  saveBtnTxt: { color: '#1A0F00', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 10, borderWidth: 1 },
  actionBtnTxt: { fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', gap: 16 },
  accessDenied: { color: '#FF5000', fontSize: 18, fontWeight: '600' },
  backBtn: { backgroundColor: '#1C1C1E', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: '#fff', fontWeight: '600' },
  scrollContent: { padding: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, alignItems: 'center' },
  statValue: { color: colors.green, fontSize: 28, fontWeight: '700' },
  statLabel: { color: '#A1A1AA', fontSize: 12, marginTop: 4 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  formCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 24 },
  formInput: { backgroundColor: '#000', borderRadius: 10, borderWidth: 1, borderColor: '#27272A', padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  typePill: { flex: 1, paddingVertical: 8, borderRadius: 20, backgroundColor: '#000', alignItems: 'center', borderWidth: 1, borderColor: '#27272A' },
  typePillActive: { backgroundColor: colors.green, borderColor: colors.green },
  typeText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  typeTextActive: { color: '#000' },
  sendAlertBtn: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sendAlertBtnDisabled: { opacity: 0.6 },
  toolBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, minHeight: 70 },
  toolBtnTxt: { fontSize: 11, fontWeight: '700', textAlign: 'center', letterSpacing: 0.3 },
  sendAlertBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  userCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 12, padding: 14, marginBottom: 8, gap: 10 },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  actionBtnRevoke: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.red + '88', flexShrink: 0 },
  actionBtnRevokeTxt: { color: colors.red, fontSize: 12, fontWeight: '700' },
  actionBtnReinstate: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.greenBgStrong, borderWidth: 1, borderColor: colors.green + '66', flexShrink: 0 },
  actionBtnReinstateTxt: { color: colors.green, fontSize: 12, fontWeight: '700' },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerBackBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, minWidth: 72 },
  headerBackLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '500', marginLeft: 2 },
  pageTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  avatarBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#27272A', justifyContent: 'center', alignItems: 'center' },
  avatarBadgeAdmin: { backgroundColor: colors.greenBgStrong },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  userName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  userEmail: { color: '#555', fontSize: 12, marginTop: 2 },
  adminBadge: { backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  adminBadgeText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  discordCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  discordDot: { width: 10, height: 10, borderRadius: 5 },
  discordTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  discordMeta: { color: colors.textSecondary, fontSize: 11 },
  importCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: colors.border },
  importBtn: { backgroundColor: colors.green, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  importBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  importStatus: { backgroundColor: '#000', borderRadius: 8, padding: 10, marginBottom: 12 },
  importStatusLabel: { fontSize: 13, fontWeight: '600' },
  importSubLabel: { color: '#888', fontSize: 11, marginTop: 4 },
});
