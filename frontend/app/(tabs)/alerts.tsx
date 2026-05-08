import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, TextInput, Modal, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch, timeAgo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius } from '../../theme';
import GuestGate from '../../components/GuestGate';

interface AlertItem {
  id: string; title: string; message: string; type: string; ticker: string; price: string; source: string; created_by: string; created_at: string; severity?: string;
}

// Derive green/red from stored type
const isBearish = (type: string) => type === 'bearish' || type === 'loss';
const alertColor = (type: string) => isBearish(type) ? colors.red : colors.green;
const alertBg = (type: string) => isBearish(type) ? colors.redBg : colors.greenBg;
const alertBorderColor = (type: string) => isBearish(type) ? 'rgba(245,70,107,0.15)' : 'rgba(0,212,160,0.15)';
const alertLabel = (type: string) => isBearish(type) ? 'LOSER' : 'WINNER';
const alertIcon = (type: string): any => isBearish(type) ? 'trending-down' : 'trending-up';

export default function AlertsScreen() {
  const { user, isGuest } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editAlert, setEditAlert] = useState<AlertItem | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const [newTicker, setNewTicker] = useState('NDX');
  const [newType, setNewType] = useState<'bullish' | 'bearish'>('bullish');
  const [sending, setSending] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try { const d = await apiFetch('/api/alerts'); setAlerts(d.alerts || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (isGuest) return;
    fetchAlerts();
    const i = setInterval(fetchAlerts, 5000);
    return () => clearInterval(i);
  }, [fetchAlerts, isGuest]);

  if (isGuest) {
    return (
      <GuestGate
        featureName="Trade Alerts"
        icon="notifications"
        description="Real-time trade alerts from our admins and Discord channel. Create a free account to receive instant push notifications when new signals post."
      />
    );
  }

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
      await apiFetch('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim() || 'Trade Signal',
          message: newMsg.trim(),
          ticker: (newTicker.trim() || 'NDX').toUpperCase(),
          type: newType,
          severity: 'high',
        }),
      });
      resetForm(); setShowCreate(false); fetchAlerts();
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to send'); }
    finally { setSending(false); }
  };

  const updateAlert = async () => {
    if (!editAlert) return;
    setSending(true);
    try {
      await apiFetch(`/api/alerts/${editAlert.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: newTitle.trim() || editAlert.title,
          message: newMsg.trim() || editAlert.message,
          ticker: newTicker.trim(),
          type: newType,
        }),
      });
      resetForm(); setShowEdit(false); setEditAlert(null); fetchAlerts();
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to update'); }
    finally { setSending(false); }
  };

  const openEditModal = (alert: AlertItem) => {
    setEditAlert(alert);
    setNewTitle(alert.title);
    setNewMsg(alert.message);
    setNewTicker(alert.ticker || 'NDX');
    setNewType(isBearish(alert.type) ? 'bearish' : 'bullish');
    setShowEdit(true);
  };

  const resetForm = () => {
    setNewTitle(''); setNewMsg(''); setNewTicker('NDX'); setNewType('bullish');
  };

  const renderAlert = ({ item, index }: { item: AlertItem; index: number }) => {
    const newest = index === 0;
    const accentColor = alertColor(item.type);
    const accentBg = alertBg(item.type);
    const accentBorder = alertBorderColor(item.type);
    const label = alertLabel(item.type);
    const icon = alertIcon(item.type);

    return (
      <View style={[st.card, { borderLeftColor: accentColor, borderColor: newest ? accentBorder : colors.border }]}>
        <View style={st.cardTop}>
          <View style={[st.sigBadge, { backgroundColor: accentBg }]}>
            <Ionicons name={icon} size={11} color={accentColor} />
            <Text style={[st.sigTxt, { color: accentColor }]}>{label}</Text>
          </View>
          <Text style={st.cardTime}>{timeAgo(item.created_at)}</Text>
        </View>
        <View style={st.priceRow}>
          <Text style={st.ndxL}>{item.ticker || 'NDX'}</Text>
          <Text style={st.at}>@</Text>
          <Text style={[st.priceV, { color: accentColor }]}>{item.price || item.message}</Text>
        </View>
        {item.message && item.message !== item.title && item.message !== item.price && (
          <Text style={st.cardMsg}>{item.message}</Text>
        )}
        <View style={st.cardBot}>
          <View style={st.srcRow}>
            <Ionicons name="pulse" size={11} color={colors.textMuted} />
            <Text style={st.srcTxt}>{item.created_by || 'Alerts Command'}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {newest && (
              <View style={[st.newBadge, { backgroundColor: accentBg, borderColor: accentBorder }]}>
                <Text style={[st.newTxt, { color: accentColor }]}>NEW</Text>
              </View>
            )}
            {isAdmin && (
              <>
                <TouchableOpacity onPress={() => openEditModal(item)} style={st.editBtn}>
                  <Ionicons name="pencil-outline" size={13} color={colors.blue} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(item)} style={st.delBtn}>
                  <Ionicons name="trash-outline" size={13} color={colors.red} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  // Create/Edit Modal
  const renderModal = (isEdit: boolean) => {
    const visible = isEdit ? showEdit : showCreate;
    const onClose = () => { isEdit ? setShowEdit(false) : setShowCreate(false); resetForm(); setEditAlert(null); };
    const onSubmit = isEdit ? updateAlert : sendManualAlert;
    const title = isEdit ? 'Edit Alert' : 'Send Alert';

    return (
      <Modal visible={visible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={st.modalOv}>
            <View style={st.modalCard}>
              <Text style={st.modalTitle}>{title}</Text>
              <Text style={st.modalSub}>{isEdit ? 'Update alert details' : 'Push to all registered devices'}</Text>
              <ScrollView keyboardShouldPersistTaps="handled">

                {/* WIN / LOSS toggle — always visible */}
                <Text style={st.fieldLabel}>TYPE</Text>
                <View style={st.typeRow}>
                  <TouchableOpacity
                    style={[st.typeBtn, newType === 'bullish' && st.typeBtnWin]}
                    onPress={() => setNewType('bullish')}
                  >
                    <Ionicons name="trending-up" size={14} color={newType === 'bullish' ? colors.green : colors.textMuted} />
                    <Text style={[st.typeTxt, newType === 'bullish' && st.typeTxtWin]}>WINNER</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.typeBtn, newType === 'bearish' && st.typeBtnLoss]}
                    onPress={() => setNewType('bearish')}
                  >
                    <Ionicons name="trending-down" size={14} color={newType === 'bearish' ? colors.red : colors.textMuted} />
                    <Text style={[st.typeTxt, newType === 'bearish' && st.typeTxtLoss]}>LOSER</Text>
                  </TouchableOpacity>
                </View>

                {isEdit && (
                  <>
                    <Text style={st.fieldLabel}>Title</Text>
                    <TextInput style={st.modalInput} value={newTitle} onChangeText={setNewTitle} placeholder="Alert title" placeholderTextColor={colors.textMuted} />
                  </>
                )}
                <Text style={st.fieldLabel}>{isEdit ? 'Message' : 'Alert Content'}</Text>
                <TextInput
                  style={[st.modalInput, { minHeight: 60 }]}
                  value={newMsg}
                  onChangeText={setNewMsg}
                  placeholder={isEdit ? 'Alert message' : 'NDX @ 24,580 - support bounce'}
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
                {isEdit && (
                  <>
                    <Text style={st.fieldLabel}>Ticker</Text>
                    <TextInput style={st.modalInput} value={newTicker} onChangeText={setNewTicker} placeholder="NDX" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
                  </>
                )}
              </ScrollView>
              <View style={st.modalActions}>
                <TouchableOpacity style={st.modalCancel} onPress={onClose}>
                  <Text style={st.modalCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.modalSend, { backgroundColor: newType === 'bearish' ? colors.red : colors.green }, (!newMsg.trim() || sending) && { opacity: 0.5 }]}
                  onPress={onSubmit}
                  disabled={!newMsg.trim() || sending}
                >
                  {sending
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={st.modalSendTxt}>{isEdit ? 'Update' : 'Send Alert'}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  if (loading) return <View style={st.ctr}><ActivityIndicator size="large" color={colors.green} /></View>;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {renderModal(false)}
      {renderModal(true)}

      <View style={st.header}>
        <View>
          <View style={st.hRow}><Text style={st.prefix}>⟩</Text><Text style={st.title}>Trade Alerts</Text></View>
          <Text style={st.sub}>Real-time Trade Signals</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {isAdmin && (
            <TouchableOpacity style={st.addBtn} onPress={() => { resetForm(); setShowCreate(true); }}>
              <Ionicons name="add" size={18} color={colors.green} />
              <Text style={st.addTxt}>Send</Text>
            </TouchableOpacity>
          )}
          <View style={st.live}><View style={st.liveDot} /><Text style={st.liveTxt}>LIVE</Text></View>
        </View>
      </View>

      <FlatList
        data={alerts}
        keyExtractor={i => i.id}
        renderItem={renderAlert}
        contentContainerStyle={st.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={st.empty}>
            <View style={st.emptyIcon}><Ionicons name="flash-outline" size={48} color={colors.textMuted} /></View>
            <Text style={st.emptyTitle}>Waiting for Signals</Text>
            <Text style={st.emptyTxt}>Trade alerts and signals will appear here in real-time.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  ctr: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prefix: { color: colors.green, fontSize: 22, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 11, color: colors.textTertiary, marginTop: 2, marginLeft: 28 },
  live: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 5, borderWidth: 1, borderColor: 'rgba(0,212,160,0.15)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  liveTxt: { color: colors.green, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, gap: 3, borderWidth: 1, borderColor: 'rgba(0,212,160,0.15)' },
  addTxt: { color: colors.green, fontSize: 11, fontWeight: '700' },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderLeftWidth: 3 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sigBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100 },
  sigTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  cardTime: { color: colors.textMuted, fontSize: 11 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  ndxL: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
  at: { color: colors.textMuted, fontSize: 13 },
  priceV: { fontSize: 26, fontWeight: '800' },
  cardMsg: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  cardBot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  srcTxt: { color: colors.textMuted, fontSize: 10 },
  newBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  newTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  editBtn: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.blueBg, justifyContent: 'center', alignItems: 'center' },
  delBtn: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.redBg, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  emptyTxt: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  // Modal
  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: colors.border, maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSub: { color: colors.textTertiary, fontSize: 12, marginBottom: 16 },
  fieldLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6, marginTop: 12 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15 },
  // WIN / LOSS type toggle
  typeRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  typeBtnWin: { backgroundColor: colors.greenBg, borderColor: colors.green },
  typeBtnLoss: { backgroundColor: colors.redBg, borderColor: colors.red },
  typeTxt: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  typeTxtWin: { color: colors.green },
  typeTxtLoss: { color: colors.red },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceHover, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelTxt: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  modalSend: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalSendTxt: { color: '#000', fontSize: 15, fontWeight: '700' },
});

interface AlertItem {
  id: string; title: string; message: string; type: string; ticker: string; price: string; source: string; created_by: string; created_at: string; severity?: string;
}

export default function AlertsScreen() {
  const { user, isGuest } = useAuth();
  const isAdmin = user?.is_admin === true;
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editAlert, setEditAlert] = useState<AlertItem | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const [newTicker, setNewTicker] = useState('NDX');
  const [newSeverity, setNewSeverity] = useState('high');
  const [sending, setSending] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try { const d = await apiFetch('/api/alerts'); setAlerts(d.alerts || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (isGuest) return;
    fetchAlerts();
    const i = setInterval(fetchAlerts, 5000);
    return () => clearInterval(i);
  }, [fetchAlerts, isGuest]);

  // Guest gate — alerts are account-only
  if (isGuest) {
    return (
      <GuestGate
        featureName="Trade Alerts"
        icon="notifications"
        description="Real-time trade alerts from our admins and TradingView webhook pipeline. Create a free account to receive instant push notifications when new signals post."
      />
    );
  }

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
      await apiFetch('/api/alerts', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim() || 'Trade Signal',
          message: newMsg.trim(),
          ticker: (newTicker.trim() || 'NDX').toUpperCase(),
          type: 'info',
          severity: newSeverity || 'high',
        }),
      });
      resetForm(); setShowCreate(false); fetchAlerts();
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to send'); }
    finally { setSending(false); }
  };

  const updateAlert = async () => {
    if (!editAlert) return;
    setSending(true);
    try {
      await apiFetch(`/api/alerts/${editAlert.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: newTitle.trim() || editAlert.title,
          message: newMsg.trim() || editAlert.message,
          ticker: newTicker.trim(),
          severity: newSeverity,
        }),
      });
      resetForm(); setShowEdit(false); setEditAlert(null); fetchAlerts();
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to update'); }
    finally { setSending(false); }
  };

  const openEditModal = (alert: AlertItem) => {
    setEditAlert(alert);
    setNewTitle(alert.title);
    setNewMsg(alert.message);
    setNewTicker(alert.ticker || 'NDX');
    setNewSeverity(alert.severity || 'high');
    setShowEdit(true);
  };

  const resetForm = () => {
    setNewTitle(''); setNewMsg(''); setNewTicker('NDX'); setNewSeverity('high');
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
          <Text style={st.ndxL}>{item.ticker || 'NDX'}</Text><Text style={st.at}>@</Text>
          <Text style={st.priceV}>{item.price || item.message}</Text>
        </View>
        {item.message && item.message !== item.title && item.message !== item.price && <Text style={st.cardMsg}>{item.message}</Text>}
        <View style={st.cardBot}>
          <View style={st.srcRow}><Ionicons name="pulse" size={11} color={colors.textMuted} /><Text style={st.srcTxt}>{item.created_by || 'Alerts Command'}</Text></View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {newest && <View style={st.newBadge}><Text style={st.newTxt}>NEW</Text></View>}
            {isAdmin && (
              <>
                <TouchableOpacity onPress={() => openEditModal(item)} style={st.editBtn}><Ionicons name="pencil-outline" size={13} color={colors.blue} /></TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(item)} style={st.delBtn}><Ionicons name="trash-outline" size={13} color={colors.red} /></TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    );
  };

  // Create/Edit Modal
  const renderModal = (isEdit: boolean) => {
    const visible = isEdit ? showEdit : showCreate;
    const onClose = () => { isEdit ? setShowEdit(false) : setShowCreate(false); resetForm(); setEditAlert(null); };
    const onSubmit = isEdit ? updateAlert : sendManualAlert;
    const title = isEdit ? 'Edit Alert' : 'Send Alert';

    return (
      <Modal visible={visible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={st.modalOv}>
            <View style={st.modalCard}>
              <Text style={st.modalTitle}>{title}</Text>
              <Text style={st.modalSub}>{isEdit ? 'Update alert details' : 'Push to all registered devices'}</Text>
              <ScrollView keyboardShouldPersistTaps="handled">
                {isEdit && (
                  <>
                    <Text style={st.fieldLabel}>Title</Text>
                    <TextInput style={st.modalInput} value={newTitle} onChangeText={setNewTitle} placeholder="Alert title" placeholderTextColor={colors.textMuted} />
                  </>
                )}
                <Text style={st.fieldLabel}>{isEdit ? 'Message' : 'Alert Content'}</Text>
                <TextInput style={[st.modalInput, { minHeight: 60 }]} value={newMsg} onChangeText={setNewMsg} placeholder={isEdit ? "Alert message" : "NDX @ 24,580 - support bounce"} placeholderTextColor={colors.textMuted} multiline />
                {isEdit && (
                  <>
                    <Text style={st.fieldLabel}>Ticker</Text>
                    <TextInput style={st.modalInput} value={newTicker} onChangeText={setNewTicker} placeholder="NDX" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
                    <Text style={st.fieldLabel}>Severity</Text>
                    <View style={st.sevRow}>
                      {['high', 'medium', 'low'].map(s => (
                        <TouchableOpacity key={s} style={[st.sevBtn, newSeverity === s && st.sevBtnActive]} onPress={() => setNewSeverity(s)}>
                          <Text style={[st.sevTxt, newSeverity === s && st.sevTxtActive]}>{s.toUpperCase()}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </ScrollView>
              <View style={st.modalActions}>
                <TouchableOpacity style={st.modalCancel} onPress={onClose}><Text style={st.modalCancelTxt}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[st.modalSend, (!newMsg.trim() || sending) && { opacity: 0.5 }]} onPress={onSubmit} disabled={!newMsg.trim() || sending}>
                  {sending ? <ActivityIndicator size="small" color="#000" /> : <Text style={st.modalSendTxt}>{isEdit ? 'Update' : 'Send Alert'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  if (loading) return <View style={st.ctr}><ActivityIndicator size="large" color={colors.green} /></View>;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {renderModal(false)}
      {renderModal(true)}

      <View style={st.header}>
        <View>
          <View style={st.hRow}><Text style={st.prefix}>⟩</Text><Text style={st.title}>Trade Alerts</Text></View>
          <Text style={st.sub}>Real-time Trade Signals</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {isAdmin && <TouchableOpacity style={st.addBtn} onPress={() => { resetForm(); setShowCreate(true); }}><Ionicons name="add" size={18} color={colors.green} /><Text style={st.addTxt}>Send</Text></TouchableOpacity>}
          <View style={st.live}><View style={st.liveDot} /><Text style={st.liveTxt}>LIVE</Text></View>
        </View>
      </View>

      <FlatList data={alerts} keyExtractor={i => i.id} renderItem={renderAlert} contentContainerStyle={st.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAlerts(); }} tintColor={colors.green} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<View style={st.empty}><View style={st.emptyIcon}><Ionicons name="flash-outline" size={48} color={colors.textMuted} /></View><Text style={st.emptyTitle}>Waiting for Signals</Text><Text style={st.emptyTxt}>Trade alerts and signals will appear here in real-time.</Text></View>}
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
  editBtn: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.blueBg, justifyContent: 'center', alignItems: 'center' },
  delBtn: { width: 28, height: 28, borderRadius: 7, backgroundColor: colors.redBg, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: '#fff', fontSize: 17, fontWeight: '700' }, emptyTxt: { color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  // Modal
  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: colors.border, maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSub: { color: colors.textTertiary, fontSize: 12, marginBottom: 16 },
  fieldLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6, marginTop: 12 },
  modalInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15 },
  sevRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  sevBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.bg, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  sevBtnActive: { backgroundColor: colors.greenBg, borderColor: colors.green },
  sevTxt: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  sevTxtActive: { color: colors.green },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceHover, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelTxt: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  modalSend: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.green, alignItems: 'center' },
  modalSendTxt: { color: '#000', fontSize: 15, fontWeight: '700' },
});
