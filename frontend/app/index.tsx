import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';

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
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  if (user) return null;

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
          {/* Brand Hero */}
          <View style={styles.brandSection}>
            <View style={styles.logoGlow}>
              <Image source={require('../assets/ndx-logo.png')} style={styles.logoImage} resizeMode="contain" />
            </View>
            <Text style={styles.brandName}>NDX Command</Text>
            <Text style={styles.brandTagline}>THE TRADING INTELLIGENCE PLATFORM.</Text>
            <Text style={styles.brandDesc}>Real-time NDX tracking, AI sentiment analysis,{'\n'}and community-driven trade intelligence.</Text>
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
                <TextInput testID="auth-password-input" style={styles.input} placeholder="Your password" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
                <TouchableOpacity testID="auth-toggle-password" onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textTertiary} />
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

  demoHint: { marginTop: spacing.lg, alignItems: 'center' },
  demoText: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.3 },
});
