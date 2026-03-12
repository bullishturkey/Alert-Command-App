import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function TabLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#00C805" />
      </View>
    );
  }

  if (!user) return <Redirect href="/" />;

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: '#0A0A0A', borderTopColor: '#1C1C1E', borderTopWidth: 1, height: 85, paddingBottom: 28, paddingTop: 8 },
      tabBarActiveTintColor: '#00C805',
      tabBarInactiveTintColor: '#555',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index" options={{
        title: 'Markets',
        tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
      }} />
      <Tabs.Screen name="charts" options={{
        title: 'Charts',
        tabBarIcon: ({ color, size }) => <Ionicons name="analytics" size={size} color={color} />,
      }} />
      <Tabs.Screen name="alerts" options={{
        title: 'Alerts',
        tabBarIcon: ({ color, size }) => <Ionicons name="notifications" size={size} color={color} />,
      }} />
      <Tabs.Screen name="news" options={{
        title: 'News',
        tabBarIcon: ({ color, size }) => <Ionicons name="newspaper" size={size} color={color} />,
      }} />
      <Tabs.Screen name="chat" options={{
        title: 'Chat',
        tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
      }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
});
