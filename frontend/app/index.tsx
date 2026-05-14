import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';

export default function AuthScreen() {
  const { user, isLoading, isGuest, login, register, continueAsGuest } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  if (user || isGuest) return null;

  const handleSubmit = async () => {
    // Trim whitespace — mobile keyboards often add a trailing space when typing/pasting
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedUsername = username.trim();
    if (!trimmedEmail || !trimmedPassword || (!isLogin && !trimmedUsername)) {
      setError('Please fill in all fields');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await login(trimmedEmail, trimmedPassword, rememberMe);
      } else {
        await register(trimmedEmail, trimmedUsername, trimmedPassword);
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
          {/* Brand Hero */}
          <View style={styles.brandSection}>
            <View style={styles.logoGlow}>
              <Image source={require('../assets/ndx-logo.png')} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.brandName}>Alerts Command</Text>
            <Text style={styles.brandTagline}>THE TRADING INTELLIGENCE PLATFORM.</Text>
          </View>

          {/* Form Card */}
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
                <Ionicons name="alert-circle" size={16} color={colors.red} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={18} color={colors.textTertiary} style={styles.inputIcon} />
                <TextInput testID="auth-email-input" style={styles.input} placeholder="you@example.com" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              </View>
            </View>

            {!isLogin && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Username</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="person-outline" size={18} color={colors.textTertiary} style={styles.inputIcon} />
                  <TextInput testID="auth-username-input" style={styles.input} placeholder="Your username" placeholderTextColor={colors.textMuted} value={username} onChangeText={setUsername} autoCapitalize="none" />
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} style={styles.inputIcon} />
                <TextInput testID="auth-password-input" style={styles.input} placeholder="Your password" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} spellCheck={false} />
                <TouchableOpacity testID="auth-toggle-password" onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity testID="auth-submit-btn" style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={loading} activeOpacity={0.8}>
              {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.submitBtnText}>{isLogin ? 'Sign In' : 'Create Account'}</Text>}
            </TouchableOpacity>

            {isLogin && (
              <TouchableOpacity
                testID="remember-me-toggle"
                style={styles.rememberRow}
                onPress={() => setRememberMe(!rememberMe)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                  {rememberMe && <Ionicons name="checkmark" size={12} color="#000" />}
                </View>
                <Text style={styles.rememberLabel}>Stay logged in for 90 days</Text>
              </TouchableOpacity>
            )}

            {isLogin && (
              <View style={styles.demoHint}>
                <Text style={styles.demoText}>New here? Sign up to get started</Text>
              </View>
            )}
          </View>

          {/* Guest Access */}
          <TouchableOpacity style={styles.guestBtn} onPress={continueAsGuest} activeOpacity={0.7}>
            <Ionicons name="eye-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.guestBtnText}>Browse as Guest</Text>
          </TouchableOpacity>
          <Text style={styles.guestHint}>View market data without an account</Text>

          {/* Disclaimer */}
          <Text style={styles.disclaimer}>Alerts Command is an independent, third-party tool.{'\n'}Not affiliated with Nasdaq, Inc. or any stock exchange.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xxl },
  loadingContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },

  // Brand
  brandSection: { alignItems: 'center', marginBottom: 40 },
  logoGlow: { 
    width: 100, height: 100, borderRadius: 24, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,200,5,0.06)', borderWidth: 1, borderColor: 'rgba(0,200,5,0.12)', marginBottom: 20,
  },
  logoImage: { width: 80, height: 80, borderRadius: 18 },
  brandName: { fontSize: 34, fontWeight: '800', color: colors.textPrimary, letterSpacing: 1 },
  brandTagline: { fontSize: 12, color: colors.green, marginTop: 8, letterSpacing: 2, fontWeight: '700' },
  brandDesc: { fontSize: 13, color: colors.textTertiary, marginTop: 12, textAlign: 'center', lineHeight: 19 },

  // Form
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border },
  tabRow: { flexDirection: 'row', marginBottom: spacing.xxl, backgroundColor: colors.bg, borderRadius: radius.sm, padding: 3, borderWidth: 1, borderColor: colors.borderSubtle },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 6, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surfaceElevated },
  tabText: { color: colors.textTertiary, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.textPrimary },

  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.redBg, padding: spacing.md, borderRadius: radius.sm, marginBottom: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(255,68,68,0.15)' },
  errorText: { color: colors.red, fontSize: 13, flex: 1 },

  inputGroup: { marginBottom: spacing.lg },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 14 },
  eyeBtn: { padding: 8 },

  submitBtn: { backgroundColor: colors.green, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: spacing.sm },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },

  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, paddingVertical: 2 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  checkboxActive: { backgroundColor: colors.green, borderColor: colors.green },
  rememberLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },

  demoHint: { marginTop: spacing.lg, alignItems: 'center' },
  demoText: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.3 },

  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 24, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  guestBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  guestHint: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 },

  // Server config
  serverRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 20, paddingVertical: 6 },
  serverLabel: { color: colors.textMuted, fontSize: 10, maxWidth: 220 },
  serverPanel: { backgroundColor: '#1A1A1E', borderRadius: 12, padding: 14, marginTop: 6, borderWidth: 1, borderColor: '#333' },
  serverPanelTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  serverPanelHint: { color: colors.textMuted, fontSize: 11, marginBottom: 10, lineHeight: 15 },
  serverInputRow: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 10 },
  serverInput: { color: colors.textPrimary, fontSize: 13, paddingVertical: 10 },
  serverBtns: { flexDirection: 'row', gap: 8 },
  serverSaveBtn: { flex: 1, backgroundColor: colors.green, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  serverSaveBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },
  serverResetBtn: { flex: 1, backgroundColor: '#2A2A2E', borderRadius: 8, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  serverResetBtnText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

  disclaimer: { color: colors.textMuted, fontSize: 10, textAlign: 'center', marginTop: 24, lineHeight: 15, opacity: 0.6 },
});
