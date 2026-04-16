import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator, Image, Platform } from 'react-native';
import { useEffect } from 'react';
import { colors } from '../theme';

// Global locale fix for web - must run before any Intl usage
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    // Patch Date.prototype.toLocaleString to handle invalid locale
    const _origDTLS = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = function(locale?: any, options?: any) {
      try {
        if (typeof locale === 'string' && locale.includes('@')) locale = locale.split('@')[0];
        return _origDTLS.call(this, locale || 'en-US', options);
      } catch { return _origDTLS.call(this, 'en-US', options); }
    } as any;
    // Patch Number.prototype.toLocaleString
    const _origNTLS = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function(locale?: any, options?: any) {
      try {
        if (typeof locale === 'string' && locale.includes('@')) locale = locale.split('@')[0];
        return _origNTLS.call(this, locale || 'en-US', options);
      } catch { return _origNTLS.call(this, 'en-US', options); }
    } as any;
    // Patch Intl.DateTimeFormat constructor
    const _OrigDTF = Intl.DateTimeFormat;
    const PatchedDTF = function(locales?: any, options?: any) {
      let fixed = locales;
      if (typeof fixed === 'string' && fixed.includes('@')) fixed = fixed.split('@')[0];
      try { return new _OrigDTF(fixed || 'en-US', options); }
      catch { return new _OrigDTF('en-US', options); }
    } as any;
    PatchedDTF.supportedLocalesOf = _OrigDTF.supportedLocalesOf;
    PatchedDTF.prototype = _OrigDTF.prototype;
    (Intl as any).DateTimeFormat = PatchedDTF;
  } catch {}
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(tabs)' || segments[0] === 'admin' || segments[0] === 'stock';
    if (!user && inAuthGroup) {
      router.replace('/');
    } else if (user && segments.length <= 1 && !inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <View style={styles.logoWrap}>
          <Image source={require('../assets/ndx-logo.png')} style={styles.splashLogo} resizeMode="contain" />
        </View>
        <ActivityIndicator size="large" color={colors.green} style={styles.spinner} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <AuthGuard>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="admin" options={{ presentation: 'modal', headerShown: true, headerTitle: 'Admin Panel', headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.textPrimary }} />
            <Stack.Screen name="stock/[symbol]" options={{ headerShown: false }} />
          </Stack>
        </AuthGuard>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
  logoWrap: { width: 110, height: 110, borderRadius: 28, backgroundColor: 'rgba(0,200,5,0.06)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,200,5,0.12)' },
  splashLogo: { width: 90, height: 90, borderRadius: 22 },
  spinner: { marginTop: 24 },
});
