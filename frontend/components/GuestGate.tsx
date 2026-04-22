import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, radius } from '../theme';

interface Props {
  featureName: string;
  description: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}

/**
 * Full-screen gate shown when a guest (no account) tries to access
 * an account-only feature like Alerts or Preflight.
 */
export default function GuestGate({ featureName, description, icon = 'lock-closed' }: Props) {
  const router = useRouter();
  const { logout } = useAuth();

  const handleSignIn = async () => {
    // logout() clears guest mode and returns to the auth screen (index.tsx)
    await logout();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={42} color={colors.green} />
        </View>

        <Text style={styles.title}>{featureName}</Text>
        <Text style={styles.subtitle}>Account required</Text>

        <Text style={styles.description}>{description}</Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSignIn} activeOpacity={0.85}>
          <Ionicons name="log-in-outline" size={18} color="#000" />
          <Text style={styles.primaryBtnText}>Sign In or Create Account</Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Free forever · No credit card required
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    maxWidth: 320,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.green,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.md,
  },
});
