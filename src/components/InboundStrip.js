// ─────────────────────────────────────────────────────────────────────────
// InboundStrip — horizontal "Likes You" rail at the top of Discover.
// Shows people who've connected or waved at you. Tap one → MatchDetail.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from './Atoms';

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

function badgeFor(row) {
  if (row.is_match)              return { icon: 'sparkles',  label: 'Match',     color: COLORS.sage };
  if (row.their_kind === 'like') return { icon: 'heart',     label: 'Wants to connect', color: COLORS.clay };
  if (row.their_kind === 'wave') return { icon: 'hand-left', label: 'Wave',      color: COLORS.gold };
  return null;
}

function InboundCard({ row, onPress }) {
  const name = row.full_name || row.handle || 'Someone';
  const badge = badgeFor(row);
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => onPress?.(row)}>
      <Avatar
        initials={initialsFor(name)}
        size={56}
        gradientColors={gradientFor(row.profile_id)}
        uri={row.avatar_url || undefined}
      />
      <Text style={styles.name} numberOfLines={1}>{name.split(' ')[0]}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Ionicons name={badge.icon} size={9} color={badge.color} />
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function InboundStrip({ rows = [], onTap }) {
  if (!rows?.length) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Wants To Connect</Text>
        <Text style={styles.headerCount}>{rows.length}</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.profile_id}
        renderItem={({ item }) => <InboundCard row={item} onPress={onTap} />}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: SPACING.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  headerLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
  },
  headerCount: {
    fontFamily: FONT.semiBold,
    fontSize: 11,
    color: COLORS.textSecondary,
  },

  list: { paddingHorizontal: SPACING.lg, paddingVertical: 2 },

  card: {
    width: 84,
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 6,
    ...SHADOW.sm,
  },
  name: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.text,
    maxWidth: 70,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.sageBg,
  },
  badgeText: {
    fontFamily: FONT.semiBold,
    fontSize: 9,
    letterSpacing: 0.2,
  },
});
