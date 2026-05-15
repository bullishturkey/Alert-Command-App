import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Platform, Alert, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

export default function SettingsScreen() {
  const { user, logout, isGuest, deleteAccount, updateUser } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [checkingPush, setCheckingPush] = useState(true);

  // === Your Data state ===
  const [myData, setMyData] = useState<any>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [viewRawOpen, setViewRawOpen] = useState(false);

  useEffect(() => {
    checkPushStatus();
    if (!isGuest) fetchMyData();
  }, []);

  const fetchMyData = async () => {
    setDataLoading(true);
    try {
      const d = await apiFetch('/api/user/my-data');
      setMyData(d);
    } catch {
      // silent
    } finally {
      setDataLoading(false);
    }
  };

  const openEditUsername = () => {
    setUsernameDraft(user?.username || '');
    setEditUsernameOpen(true);
  };

  const saveUsername = async () => {
    const trimmed = usernameDraft.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      Alert.alert('Invalid username', 'Must be 2–32 characters.');
      return;
    }
    setSavingUsername(true);
    try {
      const res = await apiFetch('/api/user/update-profile', {
        method: 'POST',
        body: JSON.stringify({ username: trimmed }),
      });
      updateUser({ username: res.user?.username || trimmed });
      setEditUsernameOpen(false);
      fetchMyData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update username');
    } finally {
      setSavingUsername(false);
    }
  };

  const clearWatchlist = () => {
    Alert.alert('Clear Watchlist?', 'This permanently removes all symbols from your watchlist.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All', style: 'destructive', onPress: async () => {
          try {
            await apiFetch('/api/user/watchlist/clear', { method: 'DELETE' });
            fetchMyData();
            Alert.alert('Cleared', 'Your watchlist is now empty.');
          } catch (e: any) { Alert.alert('Error', e?.message || 'Failed'); }
        }
      },
    ]);
  };

  const clearPushTokens = () => {
    Alert.alert('Disable Notifications?', 'This unregisters all push tokens for your account. You can re-enable from this Settings screen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable', style: 'destructive', onPress: async () => {
          try {
            await apiFetch('/api/user/push-tokens/clear', { method: 'DELETE' });
            setPushEnabled(false);
            fetchMyData();
          } catch (e: any) { Alert.alert('Error', e?.message || 'Failed'); }
        }
      },
    ]);
  };

  const checkPushStatus = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setPushEnabled(status === 'granted');
    } catch (e) {
      console.log('Push status check error:', e);
    } finally {
      setCheckingPush(false);
    }
  };

  const togglePushNotifications = async (enabled: boolean) => {
    setPushLoading(true);
    try {
      if (enabled) {
        // Request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          Alert.alert('Permission Denied', 'Please enable notifications in your device settings.');
          setPushLoading(false);
          return;
        }
        // Get and register token
        if (Device.isDevice || Platform.OS === 'web') {
          try {
            const tokenData = await Notifications.getExpoPushTokenAsync({ projectId: undefined });
            await apiFetch('/api/notifications/register', {
              method: 'POST',
              body: JSON.stringify({ token: tokenData.data }),
            });
          } catch (tokenErr) {
            console.log('Token registration:', tokenErr);
          }
        }
        // Set Android channel
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('alerts', {
            name: 'Trade Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#00D4A0',
            sound: 'default',
          });
        }
        setPushEnabled(true);
      } else {
        // Unregister
        await apiFetch('/api/notifications/unregister', { method: 'POST' });
        setPushEnabled(false);
      }
    } catch (e: any) {
      console.log('Push toggle error:', e);
      Alert.alert('Error', 'Failed to update notification settings.');
    } finally {
      setPushLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all associated data (watchlists, push tokens, messages). This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to delete account');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.scroll}>
        {/* Header */}
        <View style={st.header}>
          <View style={st.hRow}>
            <Text style={st.prefix}>⟩</Text>
            <Text style={st.title}>Settings</Text>
          </View>
          <Text style={st.sub}>App preferences</Text>
        </View>

        {/* Profile Section */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>ACCOUNT</Text>
          <View style={st.card}>
            <View style={st.profileRow}>
              <View style={st.avatar}>
                <Text style={st.avatarText}>{(user?.username || 'U')[0].toUpperCase()}</Text>
              </View>
              <View style={st.profileInfo}>
                <Text style={st.profileName}>{user?.username || 'User'}</Text>
                <Text style={st.profileEmail}>{user?.email || ''}</Text>
                {user?.is_admin && (
                  <View style={st.adminBadge}>
                    <Ionicons name="shield-checkmark" size={10} color={colors.green} />
                    <Text style={st.adminTxt}>ADMIN</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* Notifications Section */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>NOTIFICATIONS</Text>
          <View style={st.card}>
            <View style={st.settingRow}>
              <View style={st.settingLeft}>
                <View style={[st.settingIcon, { backgroundColor: colors.greenBg }]}>
                  <Ionicons name="notifications" size={18} color={colors.green} />
                </View>
                <View>
                  <Text style={st.settingLabel}>Push Notifications</Text>
                  <Text style={st.settingDesc}>Get real-time trade alerts</Text>
                </View>
              </View>
              {checkingPush || pushLoading ? (
                <ActivityIndicator size="small" color={colors.green} />
              ) : (
                <Switch
                  value={pushEnabled}
                  onValueChange={togglePushNotifications}
                  trackColor={{ false: colors.surfaceHover, true: colors.greenBgStrong }}
                  thumbColor={pushEnabled ? colors.green : colors.textMuted}
                  ios_backgroundColor={colors.surfaceHover}
                />
              )}
            </View>
          </View>
        </View>

        {/* Your Data Section — replaces "About" */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>YOUR DATA</Text>

          {/* Encryption notice */}
          <View style={[st.card, { borderColor: 'rgba(0,200,5,0.35)', backgroundColor: colors.greenBg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="shield-checkmark" size={22} color={colors.green} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.green, fontWeight: '700', fontSize: 13 }}>End-to-end encrypted at rest</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 }}>
                  Your password is bcrypt-hashed, your Tastytrade credentials are Fernet-encrypted, and the connection is HTTPS-only. We never display your secrets in full.
                </Text>
              </View>
            </View>
          </View>

          {/* Profile */}
          <Text style={st.subhead}>Profile</Text>
          <View style={st.card}>
            <TouchableOpacity style={st.dataRow} onPress={openEditUsername} disabled={isGuest}>
              <View style={{ flex: 1 }}>
                <Text style={st.dataLabel}>Username</Text>
                <Text style={st.dataValue}>{user?.username || '—'}</Text>
              </View>
              {!isGuest && <Ionicons name="pencil" size={16} color={colors.textTertiary} />}
            </TouchableOpacity>
            <View style={st.divider} />
            <View style={st.dataRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.dataLabel}>Email</Text>
                <Text style={st.dataValue}>{user?.email || '—'}</Text>
              </View>
              <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            </View>
            <View style={st.divider} />
            <View style={st.dataRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.dataLabel}>Account ID</Text>
                <Text style={[st.dataValue, { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]} numberOfLines={1}>{user?.id || '—'}</Text>
              </View>
            </View>
          </View>

          {/* Data on device */}
          <Text style={st.subhead}>Saved Data</Text>
          <View style={st.card}>
            <View style={st.dataRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.dataLabel}>Watchlist</Text>
                <Text style={st.dataValue}>{dataLoading ? '…' : `${myData?.watchlist?.length || 0} symbols`}</Text>
                {myData?.watchlist?.length > 0 && (
                  <Text style={st.dataMeta} numberOfLines={1}>{myData.watchlist.slice(0, 8).join(' · ')}{myData.watchlist.length > 8 ? '…' : ''}</Text>
                )}
              </View>
              {(myData?.watchlist?.length || 0) > 0 && (
                <TouchableOpacity onPress={clearWatchlist} style={st.clearBtn}>
                  <Text style={st.clearBtnTxt}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={st.divider} />
            <View style={st.dataRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.dataLabel}>Push Notification Devices</Text>
                <Text style={st.dataValue}>{dataLoading ? '…' : `${myData?.push_tokens_count || 0} registered`}</Text>
              </View>
              {(myData?.push_tokens_count || 0) > 0 && (
                <TouchableOpacity onPress={clearPushTokens} style={st.clearBtn}>
                  <Text style={st.clearBtnTxt}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            {myData?.midas && (
              <>
                <View style={st.divider} />
                <View style={st.dataRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.dataLabel}>Midas (Tastytrade)</Text>
                    <Text style={st.dataValue}>
                      {myData.midas.connected ? `Connected · ${myData.midas.account_number || ''}` : (myData.midas.midas_enabled ? 'Enabled · Not connected' : 'Not enabled')}
                    </Text>
                    {myData.midas.connected && (
                      <Text style={[st.dataMeta, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>
                        Secret {myData.midas.client_secret_mask}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={st.divider} />
                <View style={st.dataRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.dataLabel}>Midas Trades Logged</Text>
                    <Text style={st.dataValue}>{myData.midas_trade_count || 0}</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* View raw / refresh */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <TouchableOpacity style={[st.utilBtn, { flex: 1 }]} onPress={() => setViewRawOpen(true)} disabled={!myData}>
              <Ionicons name="code-slash" size={14} color={colors.textSecondary} />
              <Text style={st.utilBtnTxt}>View Raw Data</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.utilBtn, { flex: 1 }]} onPress={fetchMyData}>
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
              <Text style={st.utilBtnTxt}>Refresh</Text>
            </TouchableOpacity>
          </View>

          <Text style={st.footnote}>
            All personal data above is stored only to provide the service. To delete everything permanently, use "Delete My Account" below.
          </Text>
        </View>

        {/* Sign Out */}
        <View style={st.section}>
          {user && (
            <>
              <TouchableOpacity style={st.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
                <Ionicons name="log-out-outline" size={20} color={colors.red} />
                <Text style={st.logoutTxt}>Sign Out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.deleteBtn} onPress={handleDeleteAccount} activeOpacity={0.7}>
                <Ionicons name="trash-outline" size={18} color={colors.red} />
                <Text style={st.deleteTxt}>Delete My Account</Text>
              </TouchableOpacity>
            </>
          )}
          {isGuest && (
            <TouchableOpacity style={st.signInBtn} onPress={logout} activeOpacity={0.7}>
              <Ionicons name="log-in-outline" size={20} color={colors.green} />
              <Text style={st.signInTxt}>Sign In / Create Account</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Edit Username Modal */}
      <Modal visible={editUsernameOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditUsernameOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={st.modalHeader}>
              <TouchableOpacity onPress={() => setEditUsernameOpen(false)}><Text style={st.modalCancel}>Cancel</Text></TouchableOpacity>
              <Text style={st.modalTitle}>Edit Username</Text>
              <TouchableOpacity onPress={saveUsername} disabled={savingUsername || usernameDraft.trim().length < 2}>
                {savingUsername ? <ActivityIndicator color={colors.green} /> : <Text style={[st.modalSave, (usernameDraft.trim().length < 2) && { opacity: 0.4 }]}>Save</Text>}
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20 }}>
              <Text style={st.modalLabel}>USERNAME</Text>
              <TextInput
                style={st.modalInput}
                value={usernameDraft}
                onChangeText={setUsernameDraft}
                placeholder="Your display name"
                placeholderTextColor={colors.textMuted}
                autoFocus
                maxLength={32}
                autoCorrect={false}
              />
              <Text style={st.modalHint}>2–32 characters. Visible to other users.</Text>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* View Raw Data Modal */}
      <Modal visible={viewRawOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setViewRawOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={st.modalHeader}>
            <View style={{ width: 60 }} />
            <Text style={st.modalTitle}>Your Raw Data</Text>
            <TouchableOpacity onPress={() => setViewRawOpen(false)}><Text style={st.modalSave}>Done</Text></TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <Text style={st.modalHint}>
              This is every field stored about your account, exactly as our server sees it. Secrets are masked (only last 4 chars).
            </Text>
            <View style={st.rawBox}>
              <Text selectable style={st.rawTxt}>{myData ? JSON.stringify(myData, null, 2) : 'Loading…'}</Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 20 },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 11, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },

  section: { marginTop: 20, paddingHorizontal: 20 },
  sectionTitle: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 10, marginLeft: 4 },

  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },

  // Profile
  profileRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.greenBg, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.green },
  avatarText: { color: colors.green, fontSize: 20, fontWeight: '800' },
  profileInfo: { flex: 1 },
  profileName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  profileEmail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  adminBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: colors.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, alignSelf: 'flex-start' },
  adminTxt: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  // Settings rows
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  settingIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  settingLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  settingDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  // Info rows
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  infoLabel: { color: colors.textSecondary, fontSize: 14 },
  infoValue: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },

  // Logout
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.redBg, borderRadius: 16, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(255,68,68,0.15)' },
  logoutTxt: { color: colors.red, fontSize: 16, fontWeight: '700' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 14, marginTop: 12, borderWidth: 1, borderColor: 'rgba(255,68,68,0.1)' },
  deleteTxt: { color: colors.red, fontSize: 14, fontWeight: '600', opacity: 0.7 },
  signInBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.greenBg, borderRadius: 16, paddingVertical: 16, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  signInTxt: { color: colors.green, fontSize: 16, fontWeight: '700' },

  // Your Data section
  subhead: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: 18, marginBottom: 8, marginLeft: 4 },
  dataRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  dataLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  dataValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dataMeta: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)', backgroundColor: 'rgba(255,68,68,0.06)' },
  clearBtnTxt: { color: colors.red, fontSize: 11, fontWeight: '700' },
  utilBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  utilBtnTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  footnote: { color: colors.textMuted, fontSize: 11, marginTop: 14, marginHorizontal: 4, lineHeight: 16 },

  // Modals
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCancel: { color: colors.textSecondary, fontSize: 15 },
  modalSave: { color: colors.green, fontSize: 15, fontWeight: '700' },
  modalLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  modalInput: { backgroundColor: colors.surfaceElevated, color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 1, borderColor: colors.border },
  modalHint: { color: colors.textMuted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  rawBox: { backgroundColor: colors.surfaceElevated, borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  rawTxt: { color: colors.textSecondary, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 17 },
});
