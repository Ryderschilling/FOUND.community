import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Pill } from './Atoms';

/**
 * GroupCard — used in GroupsScreen for joined + suggested groups
 * Props:
 *   group    { id, name, description, icon, iconColor, iconBg, memberCount,
 *              meetingDay, category, coverUrl, joined }
 *   onJoin   () => void
 *   onLeave  () => void
 *   onPress  () => void
 *   busy     boolean — disables the join/leave button
 */
export default function GroupCard({ group, onJoin, onLeave, onPress, busy }) {
  const joined = !!group.joined;

  const handleJoin = (e) => {
    e.stopPropagation?.();
    onJoin?.();
  };
  const handleLeave = (e) => {
    e.stopPropagation?.();
    onLeave?.();
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.97 }]}
      onPress={onPress}
    >
      {/* Cover photo — full-bleed banner when the group has one */}
      {group.coverUrl ? (
        <Image source={{ uri: group.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : null}

      {/* Icon + name row */}
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: group.iconBg ?? COLORS.sageBg }]}>
          <Ionicons name={group.icon ?? 'people-outline'} size={22} color={group.iconColor ?? COLORS.sage} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{group.name}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={11} color={COLORS.textTertiary} />
            <Text style={styles.meta}>
              {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            </Text>
            {group.meetingDay ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.meta}>{group.meetingDay}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Category pill */}
        {group.category ? (
          <Pill label={group.category} variant="neutral" />
        ) : null}
      </View>

      {/* Description */}
      {group.description ? (
        <Text style={styles.description} numberOfLines={2}>{group.description}</Text>
      ) : null}

      {/* Footer: join state — tap "Joined" to leave */}
      <View style={styles.footer}>
        {joined ? (
          <TouchableOpacity
            style={styles.joinedBtn}
            onPress={handleLeave}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle" size={15} color={COLORS.sage} />
            <Text style={styles.joinedText}>Joined</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={handleJoin}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.joinBtnText}>Join Group</Text>
          </TouchableOpacity>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
    gap: SPACING.sm,
  },

  cover: {
    height: 124,
    marginTop: -SPACING.md,
    marginHorizontal: -SPACING.md,
    marginBottom: SPACING.xs,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    backgroundColor: COLORS.surfaceAlt,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerInfo: { flex: 1, gap: 3 },
  name: { fontFamily: FONT.serifItalic, fontSize: 17, color: COLORS.text, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaDot: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary },
  meta:    { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary },

  description: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  joinedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  joinedText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.sage },
  joinBtn: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  joinBtnText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.text },
});
