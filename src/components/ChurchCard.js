// ─────────────────────────────────────────────────────────────────────────────
// ChurchCard
//
// Church discovery card used in the HomeScreen "Churches" filter feed.
// Displays logo (or initials fallback), name, denomination, location, distance.
//
// Props:
//   church  { id, name, city, state, logo_url, denomination,
//             member_count, distance_miles, is_verified }
//   onPress() — navigate to ChurchProfileScreen
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (a + b).toUpperCase() || '?';
}

function formatDist(mi) {
  if (mi == null) return null;
  const n = Number(mi);
  if (!isFinite(n) || n < 0) return null;
  if (n < 0.1) return '< 0.1 mi';
  if (n < 10)  return `${n.toFixed(1)} mi`;
  return `${Math.round(n)} mi`;
}

// ─── Logo / avatar ────────────────────────────────────────────────────────────

function ChurchLogo({ name, logoUrl, size = 60 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const radius = size / 2;

  if (logoUrl && !imgFailed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={[styles.logo, { width: size, height: size, borderRadius: radius }]}
        onError={() => setImgFailed(true)}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[styles.logo, styles.logoFallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.logoInitials, { fontSize: size * 0.35 }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export default function ChurchCard({ church, onPress }) {
  const dist     = formatDist(church.distance_miles);
  const location = [church.city, church.state].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.82}
      onPress={onPress}
    >
      {/* Logo */}
      <ChurchLogo name={church.name} logoUrl={church.logo_url} size={62} />

      {/* Info */}
      <View style={styles.info}>
        {/* Name + verified badge */}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {church.name}
          </Text>
          {church.is_verified ? (
            <Ionicons name="checkmark-circle" size={15} color={COLORS.sage} style={{ marginTop: 1 }} />
          ) : null}
        </View>

        {/* Denomination */}
        {church.denomination ? (
          <Text style={styles.denomination} numberOfLines={1}>
            {church.denomination}
          </Text>
        ) : null}

        {/* Location row */}
        <View style={styles.metaRow}>
          {location ? (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={12} color={COLORS.textTertiary} />
              <Text style={styles.metaText}>{location}</Text>
            </View>
          ) : null}
          {dist ? (
            <View style={styles.distBadge}>
              <Text style={styles.distText}>{dist}</Text>
            </View>
          ) : null}
        </View>

        {/* Member count */}
        {church.member_count > 0 ? (
          <View style={styles.memberRow}>
            <Ionicons name="people-outline" size={12} color={COLORS.textTertiary} />
            <Text style={styles.memberText}>
              {church.member_count} {church.member_count === 1 ? 'member' : 'members'} on FOUND
            </Text>
          </View>
        ) : null}
      </View>

      {/* Arrow */}
      <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },

  // Logo / avatar
  logo: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  logoFallback: {
    backgroundColor: COLORS.surfaceAlt ?? COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitials: {
    fontFamily: FONT.bold,
    color: COLORS.textSecondary,
  },

  // Info column
  info: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  name: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
    flexShrink: 1,
  },
  denomination: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // Location + distance row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
  },
  metaText: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  distBadge: {
    backgroundColor: COLORS.surface,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexShrink: 0,
  },
  distText: {
    fontFamily: FONT.mono ?? FONT.semiBold,
    fontSize: 11,
    color: COLORS.textSecondary,
    letterSpacing: 0.4,
  },

  // Member count row
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  memberText: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
