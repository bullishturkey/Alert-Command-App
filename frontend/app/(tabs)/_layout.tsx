import { Tabs } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../../theme';

const MIDAS_GOLD = '#FFD24A';

export default function TabLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.green} />
      </View>
    );
  }

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: colors.bg,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        height: 85,
        paddingBottom: 28,
        paddingTop: 8,
      },
      tabBarActiveTintColor: colors.green,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarLabelStyle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Markets',
        tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
      }} />
      <Tabs.Screen name="charts" options={{ href: null }} />
      <Tabs.Screen name="alerts" options={{
        title: 'Alerts',
        tabBarIcon: ({ color, size }) => <Ionicons name="notifications" size={size} color={color} />,
      }} />
      <Tabs.Screen name="news" options={{
        title: 'Preflight',
        tabBarIcon: ({ color, size }) => <Ionicons name="airplane" size={size} color={color} />,
      }} />
      <Tabs.Screen name="midas" options={{
        title: 'Midas',
        tabBarIcon: ({ focused, size }) => (
          <MaterialCommunityIcons name="robot" size={size + 2} color={focused ? MIDAS_GOLD : MIDAS_GOLD} />
        ),
        tabBarActiveTintColor: MIDAS_GOLD,
      }} />
      <Tabs.Screen name="learn" options={{
        title: 'Onboard',
        tabBarIcon: ({ color, size }) => <Ionicons name="play-circle" size={size} color={color} />,
      }} />
      <Tabs.Screen name="settings" options={{
        title: 'Settings',
        tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
      }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
});
