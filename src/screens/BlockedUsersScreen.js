import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Alert,
  useFocusEffect,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ConfirmProvider';

const AVATAR_GRADIENTS = [
  ['#4A6FA5', '#2D4E8A'],
  ['#5A8A6A', '#3D6B55'],
  ['#C0795A', '#A0593A'],
  ['#7A5AA8', '#5A3A88'],
  ['#A8793A', '#886020'],
  ['#5A7A4A', '#3D6B3E'],
  ['#4A8A6A', '#2D6B55'],
  ['#7A846A', '#5A6450'],
];

function gradientFor(id) {
  if (!id) return AVATAR_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function initialsFor(name) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase() || '··';
}

export default function BlockedUsersScreen({ navigation }) {
  const confirm = useConfirm();
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadBlockedUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_blocked_users');
      if (error) {
        console.warn('[blocked] load failed', error.message);
        setBlockedUsers([]);
      } else {
        setBlockedUsers(data ?? []);
      }
    } catch (e) {
      console.warn('[blocked] load error', e?.message);
      setBlockedUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlockedUsers();
  }, [loadBlockedUsers]);

  // Refetch when screen is focused
  useFocusEffect(
    useCallback(() => {
      loadBlockedUsers();
    }, [loadBlockedUsers])
  );

  const handleUnblock = async (userId) => {
    const user = blockedUsers.find((u) => u.profile_id === userId);
    const userName = user?.full_name || user?.handle || 'User';

    const ok = await confirm({
      title: 'Unblock user?',
      message: `${userName} will be able to see your profile and message you again.`,
      confirmLabel: 'Unblock',
      destructive: false,
    });

    if (!ok) return;

    // Optimistic removal
    setBlockedUsers((prev) => prev.filter((u) => u.profile_id !== userId));

    try {
      const { error } = await supabase.rpc('unblock_user', {
        p_target: userId,
      });

      if (error) {
        // Revert on error
        setBlockedUsers((prev) => [...prev, user]);
        Alert.alert('Could not unblock', error.message || 'Try again.');
      }
    } catch (e) {
      setBlockedUsers((prev) => [...prev, user]);
      Alert.alert('Error', e?.message || 'Something went wrong.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Blocked Users</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : blockedUsers.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="ban-outline" size={32} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>No blocked users</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {blockedUsers.map((user) => (
            <View key={user.profile_id} style={styles.userRow}>
              <Avatar
                initials={initialsFor(user.full_name || user.handle)}
                size={44}
                gradientColors={gradientFor(user.profile_id)}
                uri={user.avatar_url || undefined}
              />
              <View style={styles.userInfo}>
                <Text style={styles.userName}>
                  {user.full_name || 'Unknown'}
                </Text>
                <Text style={styles.userHandle}>@{user.handle || 'user'}</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleUnblock(user.profile_id)}
                style={styles.unblockBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.bg,
  },

  backBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  backArrow: {
    fontSize: 18,
    color: COLORS.text,
    lineHeight: 22,
  },

  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },

  headerTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.2,
  },

  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },

  userInfo: {
    flex: 1,
    marginLeft: SPACING.md,
    gap: 2,
  },

  userName: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
  },

  userHandle: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  unblockText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  emptyTitle: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
});
