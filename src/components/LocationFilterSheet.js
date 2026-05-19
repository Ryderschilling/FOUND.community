// ─────────────────────────────────────────────────────────────────────────
// LocationFilterSheet — bottom-sheet modal for choosing the Discover location
// filter. Three modes:
//
//   Anywhere     → no geographic filter, see everyone
//   Near Me      → centered on your profile location, capped by radius
//   Search city  → geocode an entered "City, State" via Nominatim, capped by radius
//
// On Apply we hand the resolved filter object back to the parent which is
// responsible for (a) persisting via saveFilter() and (b) refetching matches.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from './Atoms';
import { geocode } from '../lib/geocode';
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

  const [mode, setMode]               = useState(start.mode);
  const [cityText, setCityText]       = useState(start.cityText ?? '');
  const [cityLat, setCityLat]         = useState(start.lat ?? null);
  const [cityLng, setCityLng]         = useState(start.lng ?? null);
  const [resolvedCity, setResolved]   = useState(start.cityText ?? null); // last text that was geocoded
  const [radiusMi, setRadiusMi]       = useState(start.radiusMi ?? DEFAULT_RADIUS);
  const [geocoding, setGeocoding]     = useState(false);
  const [geoError, setGeoError]       = useState(null);

  // Re-sync when the sheet re-opens with a different filter
  useEffect(() => {
    if (!visible) return;
    const s = initialFilter ?? DEFAULT_FILTER;
    setMode(s.mode);
    setCityText(s.cityText ?? '');
    setCityLat(s.lat ?? null);
    setCityLng(s.lng ?? null);
    setResolved(s.cityText ?? null);
    setRadiusMi(s.radiusMi ?? DEFAULT_RADIUS);
    setGeoError(null);
  }, [visible, initialFilter]);

  // When the user picks "Search city" we don't auto-geocode on every keystroke
  // (1 req/sec polite limit). Geocode happens on the Search button or Apply.
  async function resolveCity() {
    const q = cityText.trim();
    if (!q) {
      setGeoError('Enter a city to search.');
      return null;
    }
    setGeoError(null);
    setGeocoding(true);
    const { lat, lng, displayName, error } = await geocode(q);
    setGeocoding(false);
    if (error) {
      setGeoError(error.message || 'Geocoder error');
      return null;
    }
    if (lat == null || lng == null) {
      setGeoError(`Couldn't find "${q}". Try "City, State" (e.g. Santa Rosa Beach, FL).`);
      return null;
    }
    setCityLat(lat); setCityLng(lng); setResolved(q);
    return { lat, lng, displayName };
  }

  async function handleApply() {
    if (mode === 'anywhere') {
      onApply?.({ mode: 'anywhere', radiusMi });
      return;
    }
    if (mode === 'self') {
      if (!selfHasLocation) {
        Alert.alert('No location set', 'Set your city in Edit Profile to use Near Me.');
        return;
      }
      onApply?.({ mode: 'self', radiusMi });
      return;
    }
    // city mode
    let lat = cityLat, lng = cityLng;
    // If the text changed since last geocode, re-resolve
    if (!lat || !lng || resolvedCity !== cityText.trim()) {
      const r = await resolveCity();
      if (!r) return;
      lat = r.lat; lng = r.lng;
    }
    onApply?.({ mode: 'city', cityText: cityText.trim(), lat, lng, radiusMi });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
              subLabel="No location filter"
              selected={mode === 'anywhere'}
              onPress={() => setMode('anywhere')}
            />
            <ModeRow
              icon="location-outline"
              label="Near Me"
              subLabel={selfHasLocation ? 'Centered on your profile location' : 'Set your location first in Edit Profile'}
              selected={mode === 'self'}
              disabled={!selfHasLocation}
              onPress={() => setMode('self')}
            />
            <ModeRow
              icon="search-outline"
              label="Search a city"
              subLabel="Find Christians in another area"
              selected={mode === 'city'}
              onPress={() => setMode('city')}
            />
          </View>

          {/* City search input (visible only in city mode) */}
          {mode === 'city' ? (
            <View style={styles.searchBlock}>
              <View style={styles.searchRow}>
                <TextInput
                  style={styles.input}
                  value={cityText}
                  onChangeText={(t) => { setCityText(t); setGeoError(null); }}
                  placeholder="City, State (e.g. Nashville, TN)"
                  placeholderTextColor={COLORS.textTertiary}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={resolveCity}
                />
                <TouchableOpacity
                  style={styles.searchBtn}
                  onPress={resolveCity}
                  disabled={geocoding}
                  activeOpacity={0.8}
                >
                  {geocoding ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
                  )}
                </TouchableOpacity>
              </View>
              {geoError ? (
                <Text style={styles.geoError}>{geoError}</Text>
              ) : (cityLat != null && cityLng != null && resolvedCity === cityText.trim()) ? (
                <View style={styles.geoOk}>
                  <Ionicons name="checkmark-circle" size={12} color={COLORS.sage} />
                  <Text style={styles.geoOkText}>Found {resolvedCity}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Radius picker — disabled in Anywhere mode */}
          <View style={styles.radiusBlock}>
            <Text style={styles.radiusLabel}>Radius</Text>
            <View style={styles.radiusRow}>
              {RADIUS_OPTIONS.map((r) => {
                const selected = radiusMi === r;
                const disabled = mode === 'anywhere';
                return (
                  <Pressable
                    key={r}
                    style={[
                      styles.radiusChip,
                      selected && styles.radiusChipSelected,
                      disabled && styles.radiusChipDisabled,
                    ]}
                    disabled={disabled}
                    onPress={() => setRadiusMi(r)}
                  >
                    <Text style={[
                      styles.radiusChipText,
                      selected && styles.radiusChipTextSelected,
                      disabled && styles.radiusChipTextDisabled,
                    ]}>
                      {r} mi
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <PrimaryButton
            label={geocoding ? 'Searching…' : 'Apply'}
            onPress={handleApply}
            disabled={geocoding}
            loading={geocoding}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </KeyboardAvoidingView>
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

  searchBlock: { marginTop: SPACING.md, gap: 6 },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
  },
  searchBtn: {
    width: 48, height: 48,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  geoError: { fontFamily: FONT.regular, fontSize: 12, color: '#C0392B', paddingHorizontal: 4 },
  geoOk:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  geoOkText:{ fontFamily: FONT.semiBold, fontSize: 12, color: COLORS.sage },

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
