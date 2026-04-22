import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { apiFetch } from '../utils/api';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function useNotifications(isAuthenticated: boolean) {
  const router = useRouter();
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  useEffect(() => {
    if (!isAuthenticated) return;

    // Register for push notifications
    registerForPushNotifications();

    // Listen for notifications received while app is open
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification.request.content.title);
    });

    // Listen for when user taps a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.type === 'alert') {
        // Navigate to alerts tab
        router.push('/(tabs)/alerts');
      }
    });

    return () => {
      // Newer expo-notifications (SDK 52+) removed `removeNotificationSubscription`.
      // Use the subscription's `.remove()` method instead, with a safe fallback.
      try {
        if (notificationListener.current) {
          if (typeof notificationListener.current.remove === 'function') {
            notificationListener.current.remove();
          } else if (typeof (Notifications as any).removeNotificationSubscription === 'function') {
            (Notifications as any).removeNotificationSubscription(notificationListener.current);
          }
        }
      } catch (e) { /* ignore cleanup errors */ }
      try {
        if (responseListener.current) {
          if (typeof responseListener.current.remove === 'function') {
            responseListener.current.remove();
          } else if (typeof (Notifications as any).removeNotificationSubscription === 'function') {
            (Notifications as any).removeNotificationSubscription(responseListener.current);
          }
        }
      } catch (e) { /* ignore cleanup errors */ }
    };
  }, [isAuthenticated]);
}

async function registerForPushNotifications() {
  try {
    // Push notifications only work on physical devices
    if (!Device.isDevice && Platform.OS !== 'web') {
      console.log('Push notifications require a physical device');
      return;
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return;
    }

    // Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: undefined, // Uses app.json config automatically
    });
    const token = tokenData.data;
    console.log('Push token:', token);

    // Register token with backend
    await apiFetch('/api/notifications/register', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    console.log('Push token registered with backend');

    // Android: set notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Trade Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00D4A0',
        sound: 'default',
      });
    }
  } catch (error) {
    console.log('Push notification registration error:', error);
  }
}
