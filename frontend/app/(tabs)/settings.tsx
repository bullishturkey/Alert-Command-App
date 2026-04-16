import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/api';
import { colors, spacing, radius } from '../../theme';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [checkingPush, setCheckingPush] = useState(true);

  useEffect(() => {
    checkPushStatus();
  }, []);

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
            lightColor: '#00C805',
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

        {/* App Info Section */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>ABOUT</Text>
          <View style={st.card}>
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>App Version</Text>
              <Text style={st.infoValue}>1.0.0</Text>
            </View>
            <View style={st.divider} />
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Platform</Text>
              <Text style={st.infoValue}>{Platform.OS === 'web' ? 'Web' : Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
            </View>
            <View style={st.divider} />
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>Data Source</Text>
              <Text style={st.infoValue}>Finnhub + yfinance</Text>
            </View>
            <View style={st.divider} />
            <View style={st.infoRow}>
              <Text style={st.infoLabel}>AI Engine</Text>
              <Text style={st.infoValue}>Claude (Anthropic)</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <View style={st.section}>
          <TouchableOpacity style={st.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={20} color={colors.red} />
            <Text style={st.logoutTxt}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
});
