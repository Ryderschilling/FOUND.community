// ─────────────────────────────────────────────────────────────────────────────
// useProfileGate
//
// Returns a gate check function + a modal component.
// A "complete" profile requires:
//   1. avatar_url  — at least one photo uploaded
//   2. bio         — at least one non-whitespace word
//
// Usage:
//   const { checkGate, ProfileGateModal } = useProfileGate(navigation);
//
//   // Inside any action handler:
//   if (!checkGate()) return;   // shows modal if incomplete, returns false
//   // ... proceed with action
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { navigationRef } from '../navigation';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';

export function useProfileGate(navigation) {
  const { profile } = useAuth();
  const [visible, setVisible] = useState(false);

  const hasPhoto = !!(profile?.avatar_url);
  const hasBio   = !!(profile?.bio?.trim());
  const isComplete = hasPhoto && hasBio;

  // Returns true if the gate passes (profile complete).
  // Returns false and shows the modal if incomplete.
  const checkGate = useCallback(() => {
    if (isComplete) return true;
    setVisible(true);
    return false;
  }, [isComplete]);

  function handleCompleteProfile() {
    setVisible(false);
    if (navigationRef.isReady()) navigationRef.navigate('EditProfile');
  }

  // What's still missing — drives the body copy
  const missing = [];
  if (!hasPhoto) missing.push('a profile photo');
  if (!hasBio)   missing.push('a short bio');
  const missingText = missing.join(' and ');

  function ProfileGateModal() {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />

            <View style={styles.iconRow}>
              <View style={styles.iconBadge}>
                <Ionicons name="person-circle-outline" size={32} color={COLORS.text} />
              </View>
            </View>

            <Text style={styles.title}>Complete your profile first</Text>
            <Text style={styles.body}>
              Add {missingText} so others know who they're connecting with. It only takes a moment.
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={handleCompleteProfile}
            >
              <Text style={styles.primaryBtnText}>Complete profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dismissBtn}
              activeOpacity={0.7}
              onPress={() => setVisible(false)}
            >
              <Text style={styles.dismissText}>Not now</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return { checkGate, ProfileGateModal, isComplete };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: RADIUS.xl ?? 20,
    borderTopRightRadius: RADIUS.xl ?? 20,
    paddingHorizontal: SPACING.xl ?? 24,
    paddingTop: SPACING.sm ?? 8,
    paddingBottom: SPACING.xxl ?? 40,
    ...SHADOW.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACING.lg ?? 20,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: SPACING.md ?? 16,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.bgSecondary ?? COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    fontFamily: FONT.bold,
    fontSize: 18,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.sm ?? 8,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xl ?? 24,
    paddingHorizontal: SPACING.sm ?? 8,
  },
  primaryBtn: {
    backgroundColor: COLORS.text,
    borderRadius: RADIUS.full ?? 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: SPACING.sm ?? 8,
  },
  primaryBtnText: {
    fontFamily: FONT.semiBold ?? FONT.bold,
    fontSize: 15,
    color: COLORS.white,
  },
  dismissBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissText: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textTertiary ?? COLORS.textSecondary,
  },
});
