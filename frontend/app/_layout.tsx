import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { useEffect } from 'react';
import { colors } from '../theme';

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
