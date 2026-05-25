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
 * Redesigned as a compact horizontal list row with square photo thumbnail on left.
 * Props:
 *   group    { id, name, description, icon, iconColor, iconBg, memberCount,
 *              meetingDay, coverUrl, joined, isPublic, hasPendingRequest }
 *   onJoin      () => void
 *   onLeave     () => void
 *   onCancelRequest () => void — withdraw pending request
 *   onPress     () => void
 *   busy        boolean — disables the join/leave button
 */
export default function GroupCard({ group, onJoin, onLeave, onCancelRequest, onPress, busy, currentUserId }) {
  const joined = !!group.joined;
  const hasPendingRequest = !!group.hasPendingRequest;
  const isPublic = group.isPublic !== false; // default public if undefined
  // You can't "leave" a group you own — show an Owner badge instead.
  const isOwner = !!group.createdBy && !!currentUserId && group.createdBy === currentUserId;

  const handleJoin = (e) => {
    e.stopPropagation?.();
    onJoin?.();
  };
  const handleLeave = (e) => {
    e.stopPropagation?.();
    onLeave?.();
  };
  const handleCancelRequest = (e) => {
    e.stopPropagation?.();
    onCancelRequest?.();
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.97 }]}
      onPress={onPress}
    >
      <View style={styles.row}>
        {/* Left: Square photo or icon thumbnail */}
        {group.coverUrl ? (
          <Image
            source={{ uri: group.coverUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, { backgroundColor: group.iconBg ?? COLORS.sageBg }]}>
            <Ionicons
              name={group.icon ?? 'people-outline'}
              size={20}
              color={group.iconColor ?? COLORS.sage}
            />
          </View>
        )}

        {/* Center: name, meta row, description */}
        <View style={styles.contentWrap}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{group.name}</Text>
            {!isPublic && (
              <Ionicons
                name="lock-closed"
                size={11}
                color={COLORS.textTertiary}
                style={styles.lockIcon}
              />
            )}
          </View>

          {/* Meta: members + schedule */}
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={10} color={COLORS.textTertiary} />
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

          {/* Description: single line */}
          {group.description ? (
            <Text style={styles.description} numberOfLines={1}>
              {group.description}
            </Text>
          ) : null}
        </View>

        {/* Right: Owner badge / Join / Pending / Joined button */}
        <View style={styles.buttonWrap}>
          {isOwner ? (
            <View style={styles.ownerBadge}>
              <Ionicons name="ribbon-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.ownerText}>Owner</Text>
            </View>
          ) : joined ? (
            <TouchableOpacity
              style={styles.joinedBtn}
              onPress={handleLeave}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle" size={14} color={COLORS.sage} />
              <Text style={styles.joinedText}>Joined</Text>
            </TouchableOpacity>
          ) : hasPendingRequest ? (
            <TouchableOpacity
              style={styles.pendingBtn}
              onPress={handleCancelRequest}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.pendingText}>Pending</Text>
            </TouchableOpacity>
          ) : isPublic ? (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={handleJoin}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.joinBtnText}>Join</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={handleJoin}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.joinBtnText}>Request</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },

  // Square thumbnail on left
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // Center content flex column
  contentWrap: {
    flex: 1,
    gap: SPACING.xs,
  },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    fontFamily: FONT.serifItalic,
    fontSize: 15,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  lockIcon: {
    marginLeft: 2,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaDot: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  meta: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  description: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // Right button wrap
  buttonWrap: {
    flexShrink: 0,
  },

  joinedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  joinedText: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.sage,
  },

  ownerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  ownerText: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  pendingBtn: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pendingText: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  joinBtn: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  joinBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.text,
  },
});
