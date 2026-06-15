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

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Animated,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from './Atoms';
import { DEFAULT_RADIUS, RADIUS_OPTIONS, DEFAULT_FILTER } from '../lib/locationFilter';
import { useToast } from './ToastProvider';
import { geocode } from '../lib/geocode';

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

  const toast = useToast();
  const [mode, setMode]               = useState(start.mode);
  const [radiusMi, setRadiusMi]       = useState(start.radiusMi ?? DEFAULT_RADIUS);
  const [locationQuery, setLocQuery]  = useState(start.displayName ?? '');
  const [geocoding, setGeocoding]     = useState(false);
  const [gpsLoading, setGpsLoading]   = useState(false);
  const [gpsCoords, setGpsCoords]     = useState(
    start.mode === 'gps' && start.lat && start.lng
      ? { lat: start.lat, lng: start.lng }
      : null
  );

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  // Re-sync when the sheet re-opens with a different filter.
  useEffect(() => {
    if (!visible) return;
    const s = initialFilter ?? DEFAULT_FILTER;
    setMode(s.mode);
    setRadiusMi(s.radiusMi ?? DEFAULT_RADIUS);
    setLocQuery(s.displayName ?? '');
    setGeocoding(false);
    setGpsLoading(false);
    setGpsCoords(
      s.mode === 'gps' && s.lat && s.lng
        ? { lat: s.lat, lng: s.lng }
        : null
    );
  }, [visible, initialFilter]);

  // Fade + scale animation
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1,    duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1,    tension: 280,  friction: 22, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0,    duration: 130, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.95, duration: 130, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  async function handleSelectGps() {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast({ title: 'Location access denied', message: 'Allow location in Settings to use this mode.', type: 'info' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setMode('gps');
    } catch {
      toast({ title: 'Could not get location', message: 'Try again or use Search Location.', type: 'error' });
    } finally {
      setGpsLoading(false);
    }
  }

  async function handleApply() {
    if (mode === 'gps') {
      if (!gpsCoords?.lat || !gpsCoords?.lng) {
        toast({ title: 'Location not ready', message: 'Tap "Current Location" to fetch your GPS first.', type: 'info' });
        return;
      }
      onApply?.({ mode: 'gps', radiusMi, lat: gpsCoords.lat, lng: gpsCoords.lng });
      return;
    }

    if (mode === 'self') {
      if (!selfHasLocation) {
        toast({ title: 'No location set', message: 'Set your city in Edit Profile to use Near Me.', type: 'info' });
        return;
      }
      onApply?.({ mode: 'self', radiusMi });
      return;
    }

    if (mode === 'custom') {
      const q = locationQuery.trim();
      if (!q) {
        toast({ title: 'Enter a location', message: 'Type a city, state, or ZIP code.', type: 'info' });
        return;
      }
      setGeocoding(true);
      const result = await geocode(q);
      setGeocoding(false);
      if (result.error || !result.lat || !result.lng) {
        toast({ title: 'Location not found', message: `Couldn't find "${q}". Try "Nashville, TN" or a ZIP code.`, type: 'error' });
        return;
      }
      // Build a short display name from the geocoder result or fall back to the raw query.
      const displayName = result.displayName
        ? result.displayName.split(',').slice(0, 2).join(',').trim()
        : q;
      onApply?.({ mode: 'custom', radiusMi, lat: result.lat, lng: result.lng, displayName });
      return;
    }

    // anywhere
    onApply?.({ mode: 'anywhere', radiusMi });
  }

  const radiusDisabled = mode === 'anywhere';
  const isWorking = geocoding || gpsLoading;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        {/* Tap-away to dismiss */}
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

        {/* Centered card */}
        <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Location</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.7}>
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
            <Pressable
              style={[
                styles.modeRow,
                mode === 'gps' && styles.modeRowSelected,
                gpsLoading && styles.modeRowDisabled,
              ]}
              onPress={handleSelectGps}
              disabled={gpsLoading}
            >
              <View style={styles.modeIcon}>
                {gpsLoading
                  ? <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  : <Ionicons name="navigate-outline" size={18} color={mode === 'gps' ? COLORS.text : COLORS.textSecondary} />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modeLabel, mode === 'gps' && styles.modeLabelSelected]}>
                  {gpsLoading ? 'Getting location…' : 'Current Location'}
                </Text>
                <Text style={styles.modeSub}>
                  {mode === 'gps' && gpsCoords
                    ? 'Using your live GPS — great for travel'
                    : 'Show people near where you are right now'}
                </Text>
              </View>
              {mode === 'gps' ? (
                <View style={styles.check}>
                  <Ionicons name="checkmark" size={14} color={COLORS.white} />
                </View>
              ) : null}
            </Pressable>
            <ModeRow
              icon="search-outline"
              label="Search Location"
              subLabel="Find people near any city or ZIP"
              selected={mode === 'custom'}
              onPress={() => setMode('custom')}
            />
          </View>

          {/* Inline location search — shown only when "Search Location" is selected */}
          {mode === 'custom' ? (
            <View style={styles.locationInputWrap}>
              <Ionicons name="search" size={15} color={COLORS.textTertiary} />
              <TextInput
                style={styles.locationInput}
                placeholder="City, State or ZIP…"
                placeholderTextColor={COLORS.textTertiary}
                value={locationQuery}
                onChangeText={setLocQuery}
                returnKeyType="search"
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
              />
              {locationQuery.length > 0 ? (
                <TouchableOpacity onPress={() => setLocQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {/* Radius picker — applies to Near Me and Search Location */}
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
            label={gpsLoading ? 'Getting location…' : geocoding ? 'Searching…' : 'Apply'}
            onPress={isWorking ? undefined : handleApply}
            style={{ marginTop: SPACING.md, opacity: isWorking ? 0.7 : 1 }}
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.lg,
    ...SHADOW.lg,
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

  locationInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 9 : 11,
  },
  locationInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
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
