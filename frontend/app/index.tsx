import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AuthScreen() {
  const { user, isLoading, login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00C805" />
      </View>
    );
  }

  if (user) return <Redirect href="/(tabs)" />;

  const handleSubmit = async () => {
    if (!email || !password || (!isLogin && !username)) {
      setError('Please fill in all fields');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, username, password);
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.brandSection}>
            <View style={styles.logoContainer}>
              <Ionicons name="trending-up" size={48} color="#00C805" />
            </View>
            <Text style={styles.brandName}>NDX Command</Text>
            <Text style={styles.brandTagline}>Trading Intelligence Platform</Text>
          </View>

          <View style={styles.formCard}>
            <View style={styles.tabRow}>
              <TouchableOpacity testID="auth-login-tab" style={[styles.tab, isLogin && styles.tabActive]} onPress={() => { setIsLogin(true); setError(''); }}>
                <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="auth-register-tab" style={[styles.tab, !isLogin && styles.tabActive]} onPress={() => { setIsLogin(false); setError(''); }}>
                <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#FF5000" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={18} color="#A1A1AA" style={styles.inputIcon} />
                <TextInput testID="auth-email-input" style={styles.input} placeholder="you@example.com" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              </View>
            </View>

            {!isLogin && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="person-outline" size={18} color="#A1A1AA" style={styles.inputIcon} />
                  <TextInput testID="auth-username-input" style={styles.input} placeholder="Your username" placeholderTextColor="#555" value={username} onChangeText={setUsername} autoCapitalize="none" />
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color="#A1A1AA" style={styles.inputIcon} />
                <TextInput testID="auth-password-input" style={styles.input} placeholder="Your password" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
                <TouchableOpacity testID="auth-toggle-password" onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#A1A1AA" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity testID="auth-submit-btn" style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.submitBtnText}>{isLogin ? 'Sign In' : 'Create Account'}</Text>}
            </TouchableOpacity>

            {isLogin && (
              <View style={styles.demoHint}>
                <Text style={styles.demoText}>Demo: admin@ndxcommand.com / admin123</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  loadingContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  brandSection: { alignItems: 'center', marginBottom: 40 },
  logoContainer: { width: 80, height: 80, borderRadius: 20, backgroundColor: 'rgba(0,200,5,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  brandName: { fontSize: 32, fontWeight: '700', color: '#fff', letterSpacing: 1 },
  brandTagline: { fontSize: 14, color: '#A1A1AA', marginTop: 4 },
  formCard: { backgroundColor: '#1C1C1E', borderRadius: 16, padding: 24 },
  tabRow: { flexDirection: 'row', marginBottom: 24, backgroundColor: '#000', borderRadius: 10, padding: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#27272A' },
  tabText: { color: '#A1A1AA', fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,80,0,0.1)', padding: 12, borderRadius: 8, marginBottom: 16, gap: 8 },
  errorText: { color: '#FF5000', fontSize: 13, flex: 1 },
  inputGroup: { marginBottom: 16 },
  label: { color: '#A1A1AA', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000', borderRadius: 10, borderWidth: 1, borderColor: '#27272A', paddingHorizontal: 12 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 14 },
  eyeBtn: { padding: 8 },
  submitBtn: { backgroundColor: '#00C805', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  demoHint: { marginTop: 16, alignItems: 'center' },
  demoText: { color: '#555', fontSize: 12 },
});
