import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';

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
        <ActivityIndicator size="large" color="#00C805" />
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
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' }, animation: 'slide_from_right' }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="admin" options={{ presentation: 'modal', headerShown: true, headerTitle: 'Admin Panel', headerStyle: { backgroundColor: '#1C1C1E' }, headerTintColor: '#fff' }} />
            <Stack.Screen name="stock/[symbol]" options={{ headerShown: false }} />
          </Stack>
        </AuthGuard>
      </View>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loading: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
});
