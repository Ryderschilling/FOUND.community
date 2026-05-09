/**
 * FOUND — Shared Atom Components
 *
 * Exports:
 *   Wordmark        — "FOUND" logotype (serif italic)
 *   AppBar          — screen top bar with title + optional right action
 *   Avatar          — initials circle with gradient or solid color
 *   Pill            — small label badge (sage, clay, neutral variants)
 *   Chip            — filter/tag chip (toggle state)
 *   PrimaryButton   — full-width dark CTA
 *   GhostButton     — outlined secondary button
 *   SectionHeader   — mono-overline + optional action link
 *   RuleLabel       — horizontal rule with centered label
 *   Card            — base surface card wrapper
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, TYPE, SPACING, RADIUS, SHADOW } from '../theme';

// ─── Wordmark ────────────────────────────────────────────────────
export function Wordmark({ size = 'md', color = COLORS.text, style }) {
  const sizes = { sm: 22, md: 28, lg: 36, xl: 48 };
  const fs = sizes[size] ?? sizes.md;
  return (
    <Text style={[{ fontFamily: FONT.serifItalic, fontSize: fs, color, letterSpacing: -0.3 }, style]}>
      found.
    </Text>
  );
}

// ─── AppBar ──────────────────────────────────────────────────────
export function AppBar({ title, subtitle, onBack, right, style }) {
  return (
    <View style={[styles.appBar, style]}>
      {/* Left: back or spacer */}
      <View style={styles.appBarSide}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Center: title */}
      <View style={styles.appBarCenter}>
        {subtitle ? (
          <Text style={styles.appBarSub}>{subtitle}</Text>
        ) : null}
        <Text style={styles.appBarTitle}>{title}</Text>
      </View>

      {/* Right: action slot */}
      <View style={[styles.appBarSide, { alignItems: 'flex-end' }]}>
        {right ?? null}
      </View>
    </View>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────
// gradientColors: [string, string] for gradient, or null for solid bg
export function Avatar({ initials, size = 48, gradientColors, bgColor, style }) {
  const radius = size / 2;
  const fontSize = size * 0.36;

  if (gradientColors) {
    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[{ width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center' }, style]}
      >
        <Text style={{ fontFamily: FONT.bold, fontSize, color: COLORS.white, letterSpacing: 0.5 }}>
          {initials}
        </Text>
      </LinearGradient>
    );
  }

  return (
    <View style={[
      { width: size, height: size, borderRadius: radius, alignItems: 'center', justifyContent: 'center', backgroundColor: bgColor ?? COLORS.surfaceAlt },
      style,
    ]}>
      <Text style={{ fontFamily: FONT.bold, fontSize, color: COLORS.text, letterSpacing: 0.5 }}>
        {initials}
      </Text>
    </View>
  );
}

// ─── Pill ─────────────────────────────────────────────────────────
// variant: 'sage' | 'clay' | 'gold' | 'neutral'
export function Pill({ label, variant = 'sage', icon, style }) {
  const palettes = {
    sage:    { bg: COLORS.sageBg,  text: COLORS.sage,          border: COLORS.sageLight },
    clay:    { bg: COLORS.clayBg,  text: COLORS.clay,          border: '#E8C4B0' },
    gold:    { bg: COLORS.goldBg,  text: COLORS.gold,          border: '#E8D4A0' },
    neutral: { bg: COLORS.surface, text: COLORS.textSecondary, border: COLORS.border },
  };
  const pal = palettes[variant] ?? palettes.neutral;

  return (
    <View style={[styles.pill, { backgroundColor: pal.bg, borderColor: pal.border }, style]}>
      {icon ? <Text style={{ fontSize: 11, marginRight: 3 }}>{icon}</Text> : null}
      <Text style={[styles.pillText, { color: pal.text }]}>{label}</Text>
    </View>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────
export function Chip({ label, active = false, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
        style,
      ]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── PrimaryButton ────────────────────────────────────────────────
export function PrimaryButton({ label, onPress, disabled, loading, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.btnPrimary, (disabled || loading) && styles.btnPrimaryDisabled, style]}
    >
      <Text style={styles.btnPrimaryText}>{loading ? '...' : label}</Text>
    </TouchableOpacity>
  );
}

// ─── GhostButton ─────────────────────────────────────────────────
export function GhostButton({ label, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.btnGhost, style]}
    >
      <Text style={styles.btnGhostText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── IconButton ──────────────────────────────────────────────────
export function IconButton({ children, onPress, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.iconBtn, style]}
    >
      {children}
    </TouchableOpacity>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────
export function SectionHeader({ label, action, onAction, style }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── RuleLabel ────────────────────────────────────────────────────
export function RuleLabel({ label, style }) {
  return (
    <View style={[styles.ruleRow, style]}>
      <View style={styles.ruleLine} />
      <Text style={styles.ruleText}>{label}</Text>
      <View style={styles.ruleLine} />
    </View>
  );
}

// ─── Card ─────────────────────────────────────────────────────────
export function Card({ children, onPress, style }) {
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.92} style={[styles.card, style]}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

// ─── Styles ───────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // AppBar
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: Platform.OS === 'ios' ? SPACING.sm : SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.bg,
  },
  appBarSide: {
    width: 44,
    alignItems: 'flex-start',
  },
  appBarCenter: {
    flex: 1,
    alignItems: 'center',
  },
  appBarTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 18,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  appBarSub: {
    ...TYPE.overline,
    marginBottom: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 18,
    color: COLORS.text,
    lineHeight: 22,
  },

  // Pill
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  pillText: {
    fontFamily: FONT.semiBold,
    fontSize: 11,
    letterSpacing: 0.1,
  },

  // Chip
  chip: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  chipInactive: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
  },
  chipText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
  },
  chipTextActive: {
    color: COLORS.white,
  },
  chipTextInactive: {
    color: COLORS.textSecondary,
  },

  // PrimaryButton
  btnPrimary: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  btnPrimaryDisabled: {
    backgroundColor: COLORS.border,
  },
  btnPrimaryText: {
    fontFamily: FONT.bold,
    fontSize: 16,
    color: COLORS.white,
    letterSpacing: 0.2,
  },

  // GhostButton
  btnGhost: {
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  btnGhostText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.textSecondary,
  },

  // IconButton
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },

  // SectionHeader
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    ...TYPE.overline,
  },
  sectionAction: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: COLORS.textSecondary,
  },

  // RuleLabel
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  ruleLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  ruleText: {
    ...TYPE.overline,
    fontSize: 9,
  },

  // Card
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.md,
  },
});
