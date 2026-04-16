import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, TextInput, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius } from '../../theme';

interface AlertItem {
  id: string; title: string; message: string; type: string; ticker: string; price: string; source: string; created_by: string; created_at: string;
}

export default function AlertsScreen() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try { const d = await apiFetch('/api/alerts'); setAlerts(d.alerts || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAlerts(); const i = setInterval(fetchAlerts, 5000); return () => clearInterval(i); }, [fetchAlerts]);

  const deleteAlert = async (id: string) => {
    try { await apiFetch(`/api/alerts/${id}`, { method: 'DELETE' }); fetchAlerts(); }
    catch (e: any) { Alert.alert('Error', e.message || 'Failed to delete'); }
  };

  const confirmDelete = (a: AlertItem) => {
    Alert.alert('Delete Alert', `Remove "${a.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteAlert(a.id) },
    ]);
  };

  const sendManualAlert = async () => {
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      await apiFetch('/api/alerts/webhook', { method: 'POST', body: JSON.stringify({ content: newMsg.trim() }) });
      setNewMsg(''); setShowCreate(false); fetchAlerts();
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to send'); }
    finally { setSending(false); }
  };

  const renderAlert = ({ item, index }: { item: AlertItem; index: number }) => {
    const newest = index === 0;
    return (
      <View style={[st.card, newest && st.cardNew]}>
        <View style={st.cardTop}>
          <View style={st.sigBadge}><Ionicons name="flash" size={11} color={colors.yellow} /><Text style={st.sigTxt}>TRADE SIGNAL</Text></View>
          <Text style={st.cardTime}>{timeAgo(item.created_at)}</Text>
        </View>
        <View style={st.priceRow}>
          <Text style={st.ndxL}>NDX</Text><Text style={st.at}>@</Text>
          <Text style={st.priceV}>{item.price || item.message}</Text>
        </View>
        {item.message && item.message !== item.title && item.message !== item.price && <Text style={st.cardMsg}>{item.message}</Text>}
        <View style={st.cardBot}>
          <View style={st.srcRow}><Ionicons name="pulse" size={11} color={colors.textMuted} /><Text style={st.srcTxt}>{item.created_by || 'TradingView'}</Text></View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {newest && <View style={st.newBadge}><Text style={st.newTxt}>NEW</Text></View>}
            {isAdmin && <TouchableOpacity onPress={() => confirmDelete(item)} style={st.delBtn}><Ionicons name="trash-outline" size={14} color={colors.red} /></TouchableOpacity>}
          </View>
        </View>
      </View>
    );
  };

  if (loading) return <View style={st.ctr}><ActivityIndicator size="large" color={colors.green} /></View>;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Create Alert Modal */}
      <Modal visible={showCreate} transparent animationType="fade">
        <View style={st.modalOv}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Send Manual Alert</Text>
            <Text style={st.modalSub}>This will push to all registered devices</Text>
            <TextInput style={st.modalInput} value={newMsg} onChangeText={setNewMsg} placeholder="NDX @ 24,580 - support bounce" placeholderTextColor={colors.textMuted} multiline />
            <View style={st.modalActions}>
              <TouchableOpacity style={st.modalCancel} onPress={() => setShowCreate(false)}><Text style={st.modalCancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[st.modalSend, (!newMsg.trim() || sending) && { opacity: 0.5 }]} onPress={sendManualAlert} disabled={!newMsg.trim() || sending}>
                {sending ? <ActivityIndicator size="small" color="#000" /> : <Text style={st.modalSendTxt}>Send Alert</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={st.header}>
        <View>
          <View style={st.hRow}><Text style={st.prefix}>⟩</Text><Text style={st.title}>NDX Alerts</Text></View>
          <Text style={st.sub}>TradingView → Pipedream Pipeline</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {isAdmin && <TouchableOpacity style={st.addBtn} onPress={() => setShowCreate(true)}><Ionicons name="add" size={18} color={colors.green} /><Text style={st.addTxt}>Send</Text></TouchableOpacity>}
          <View style={st.live}><View style={st.liveDot} /><Text style={st.liveTxt}>LIVE</Text></View>
        </View>
      </View>

      <FlatList data={alerts} keyExtractor={i => i.id} renderItem={renderAlert} contentContainerStyle={st.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<View style={st.empty}><View style={st.emptyIcon}><Ionicons name="flash-outline" size={48} color={colors.textMuted} /></View><Text style={st.emptyTitle}>Waiting for Signals</Text><Text style={st.emptyTxt}>When TradingView conditions are met, NDX price alerts will appear here.</Text></View>}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, ctr: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { color: colors.green, fontSize: 22, fontWeight: '800' }, title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 11, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  live: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 5, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }, liveTxt: { color: colors.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 3, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  addTxt: { color: colors.green, fontSize: 11, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.yellow },
  cardNew: { borderLeftColor: colors.green, borderColor: 'rgba(0,200,5,0.15)' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sigBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.yellowBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  sigTxt: { color: colors.yellow, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }, cardTime: { color: colors.textMuted, fontSize: 11 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  ndxL: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' }, at: { color: colors.textMuted, fontSize: 13 }, priceV: { color: '#fff', fontSize: 26, fontWeight: '800' },
  cardMsg: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  cardBot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, srcTxt: { color: colors.textMuted, fontSize: 10 },
  newBadge: { backgroundColor: colors.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, borderWidth: 1, borderColor: 'rgba(0,200,5,0.15)' },
  newTxt: { color: colors.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  delBtn: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.redBg, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '700' }, emptyTxt: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  // Modal
  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSub: { color: colors.textTertiary, fontSize: 12, marginBottom: 16 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15, minHeight: 60 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceHover, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelTxt: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  modalSend: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center' },
  modalSendTxt: { color: '#000', fontSize: 15, fontWeight: '700' },
});
