// ─────────────────────────────────────────────────────────────────────────
// LocationFilterSheet — bottom-sheet modal for the Discover location filter.
//
// Two modes:
//   Anywhere  → no override; the feed uses your saved Settings radius.
//   Near Me   → centered on your profile location, hard-capped by the radius.
//
// On Apply we hand the resolved filter object back to the parent, which
// (a) persists it via saveFilter() and (b) refetches matches.
//
// "Near Me" needs a geocoded profile location. If you don't have one yet the
// option is disabled — set your city in Edit Profile (or run the location
// backfill) and it lights up.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from './Atoms';
import { DEFAULT_RADIUS, RADIUS_OPTIONS, DEFAULT_FILTER } from '../lib/locationFilter';

function ModeRow({ icon, label, subLabel, selected, disabled, onPress }) {
  return (
    <Pressable
      style={[styles.modeRow, selected && styles.modeRowSelected, disabled && styles.modeRowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.modeIcon}>
        <Ionicons name={icon} size={18} color={selected ? COLORS.text : COLORS.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{label}</Text>
        {subLabel ? <Text style={styles.modeSub}>{subLabel}</Text> : null}
      </View>
      {selected ? (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={14} color={COLORS.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function LocationFilterSheet({
  visible,
  onClose,
  onApply,            // (filter) => void
  initialFilter,
  selfHasLocation,    // boolean — disables Near Me when false
}) {
  const start = initialFilter ?? DEFAULT_FILTER;

  const [mode, setMode]         = useState(start.mode);
  const [radiusMi, setRadiusMi] = useState(start.radiusMi ?? DEFAULT_RADIUS);

  // Re-sync when the sheet re-opens with a different filter.
  useEffect(() => {
    if (!visible) return;
    const s = initialFilter ?? DEFAULT_FILTER;
    setMode(s.mode);
    setRadiusMi(s.radiusMi ?? DEFAULT_RADIUS);
  }, [visible, initialFilter]);

  function handleApply() {
    if (mode === 'self') {
      if (!selfHasLocation) {
        Alert.alert('No location set', 'Set your city in Edit Profile to use Near Me.');
        return;
      }
      onApply?.({ mode: 'self', radiusMi });
      return;
    }
    // anywhere
    onApply?.({ mode: 'anywhere', radiusMi });
  }

  const radiusDisabled = mode !== 'self';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Location</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={{ gap: 8 }}>
            <ModeRow
              icon="globe-outline"
              label="Anywhere"
              subLabel="Uses your Settings radius"
              selected={mode === 'anywhere'}
              onPress={() => setMode('anywhere')}
            />
            <ModeRow
              icon="location-outline"
              label="Near Me"
              subLabel={
                selfHasLocation
                  ? 'People within the radius below'
                  : 'Set your location first in Edit Profile'
              }
              selected={mode === 'self'}
              disabled={!selfHasLocation}
              onPress={() => setMode('self')}
            />
          </View>

          {/* Radius picker — applies to Near Me only */}
          <View style={styles.radiusBlock}>
            <Text style={styles.radiusLabel}>Radius</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((r) => {
                const selected = radiusMi === r;
                return (
                  <Pressable
                    key={r}
                    style={[
                      styles.radiusChip,
                      selected && styles.radiusChipSelected,
                      radiusDisabled && styles.radiusChipDisabled,
                    ]}
                    disabled={radiusDisabled}
                    onPress={() => setRadiusMi(r)}
                  >
                    <Text style={[
                      styles.radiusChipText,
                      selected && styles.radiusChipTextSelected,
                      radiusDisabled && styles.radiusChipTextDisabled,
                    ]}>
                      {r} mi
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <PrimaryButton
            label="Apply"
            onPress={handleApply}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '92%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  title: { fontFamily: FONT.serifItalic, fontSize: 24, color: COLORS.text },

  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  modeRowSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.surfaceAlt },
  modeRowDisabled: { opacity: 0.55 },
  modeIcon: {
    width: 36, height: 36,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  modeLabel:         { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.textSecondary },
  modeLabelSelected: { color: COLORS.text },
  modeSub:           { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  check: {
    width: 22, height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.sage,
    alignItems: 'center', justifyContent: 'center',
  },

  radiusBlock: { marginTop: SPACING.lg },
  radiusLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 8,
  },
  radiusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  radiusChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  radiusChipSelected: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  radiusChipDisabled: { opacity: 0.4 },
  radiusChipText:         { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.textSecondary },
  radiusChipTextSelected: { color: COLORS.white },
  radiusChipTextDisabled: { color: COLORS.textTertiary },
});
