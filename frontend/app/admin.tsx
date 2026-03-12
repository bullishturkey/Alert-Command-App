import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';

export default function AdminScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({ users: 0, alerts: 0, messages: 0 });
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Alert form
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertTicker, setAlertTicker] = useState('');
  const [alertType, setAlertType] = useState('info');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [statsData, usersData] = await Promise.all([
        apiFetch('/api/admin/stats'),
        apiFetch('/api/admin/users'),
      ]);
      setStats(statsData);
      setUsers(usersData.users || []);
    } catch (e) {
      console.error('Admin fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

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

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#00C805" /></View>;
  }

  const TYPES = ['info', 'bullish', 'bearish', 'neutral'];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.users}</Text>
            <Text style={styles.statLabel}>Users</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.alerts}</Text>
            <Text style={styles.statLabel}>Alerts</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.messages}</Text>
            <Text style={styles.statLabel}>Messages</Text>
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
        {users.map(u => (
          <View key={u.id} style={styles.userCard}>
            <View style={styles.userInfo}>
              <View style={[styles.avatarBadge, u.is_admin && styles.avatarBadgeAdmin]}>
                <Text style={styles.avatarText}>{u.username?.charAt(0)?.toUpperCase() || '?'}</Text>
              </View>
              <View>
                <Text style={styles.userName}>{u.username}</Text>
                <Text style={styles.userEmail}>{u.email}</Text>
              </View>
            </View>
            {u.is_admin && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>Admin</Text></View>}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', gap: 16 },
  accessDenied: { color: '#FF5000', fontSize: 18, fontWeight: '600' },
  backBtn: { backgroundColor: '#1C1C1E', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: '#fff', fontWeight: '600' },
  scrollContent: { padding: 20 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, alignItems: 'center' },
  statValue: { color: '#00C805', fontSize: 28, fontWeight: '700' },
  statLabel: { color: '#A1A1AA', fontSize: 12, marginTop: 4 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  formCard: { backgroundColor: '#1C1C1E', borderRadius: 14, padding: 16, marginBottom: 24 },
  formInput: { backgroundColor: '#000', borderRadius: 10, borderWidth: 1, borderColor: '#27272A', padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  typePill: { flex: 1, paddingVertical: 8, borderRadius: 20, backgroundColor: '#000', alignItems: 'center', borderWidth: 1, borderColor: '#27272A' },
  typePillActive: { backgroundColor: '#00C805', borderColor: '#00C805' },
  typeText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  typeTextActive: { color: '#000' },
  sendAlertBtn: { backgroundColor: '#00C805', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sendAlertBtnDisabled: { opacity: 0.6 },
  sendAlertBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  userCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 12, padding: 14, marginBottom: 8 },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#27272A', justifyContent: 'center', alignItems: 'center' },
  avatarBadgeAdmin: { backgroundColor: 'rgba(0,200,5,0.2)' },
  avatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  userName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  userEmail: { color: '#555', fontSize: 12, marginTop: 2 },
  adminBadge: { backgroundColor: 'rgba(0,200,5,0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  adminBadgeText: { color: '#00C805', fontSize: 11, fontWeight: '700' },
});
