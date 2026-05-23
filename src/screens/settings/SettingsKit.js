// ─────────────────────────────────────────────────────────────────────────
// SettingsKit — shared building blocks for the Profile → Settings screens.
//
// Exports:
//   SettingsScaffold — SafeArea + nav header (back + title) + scroll body
//   SettingsGroup    — rounded card that wraps a set of rows
//   GroupLabel       — mono overline above a group
//   ToggleRow        — label + description + native Switch
//   LinkRow          — label + value + chevron (navigates / acts on press)
//   InfoRow          — static label + value (no interaction)
//   SettingsNote     — small muted helper paragraph
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Switch,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../../theme';

export function SettingsScaffold({ title, navigation, loading, children }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <View style={styles.nav}>
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function GroupLabel({ children }) {
  return <Text style={styles.groupLabel}>{children}</Text>;
}

export function SettingsGroup({ children }) {
  // Tag each child row so the last one drops its divider.
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {rows.map((child, i) =>
        React.isValidElement(child)
          ? React.cloneElement(child, { last: i === rows.length - 1 })
          : child
      )}
    </View>
  );
}

export function ToggleRow({ iconName, label, description, value, onValueChange, disabled, last }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {iconName ? (
        <View style={styles.rowIcon}>
          <Ionicons name={iconName} size={18} color={COLORS.textSecondary} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.rowDesc}>{description}</Text> : null}
      </View>
      <Switch
        value={!!value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: COLORS.border, true: COLORS.sage }}
        thumbColor={COLORS.white}
        ios_backgroundColor={COLORS.border}
      />
    </View>
  );
}

export function LinkRow({ iconName, label, value, onPress, danger, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowDivider]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {iconName ? (
        <View style={styles.rowIcon}>
          <Ionicons name={iconName} size={18} color={danger ? '#C0392B' : COLORS.textSecondary} />
        </View>
      ) : null}
      <Text style={[styles.rowLabel, styles.rowLabelFlex, danger && styles.danger]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

export function InfoRow({ iconName, label, value, last }) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {iconName ? (
        <View style={styles.rowIcon}>
          <Ionicons name={iconName} size={18} color={COLORS.textSecondary} />
        </View>
      ) : null}
      <Text style={[styles.rowLabel, styles.rowLabelFlex]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
    </View>
  );
}

export function SettingsNote({ children }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 20, color: COLORS.text },
  navTitle: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text },

  body: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },

  groupLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },

  group: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    minHeight: 56,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  rowIcon: { width: 24, alignItems: 'center' },
  rowText: { flex: 1 },
  rowLabel: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text },
  rowLabelFlex: { flex: 1 },
  rowDesc: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    lineHeight: 16,
  },
  rowValue: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  danger: { color: '#C0392B' },

  note: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    lineHeight: 17,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
});
