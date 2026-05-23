// ─────────────────────────────────────────────────────────────────────────
// LocationSettingsScreen — Profile → Settings → Location Settings
//
//   - Shows the caller's current city/state (read-only; edited on the
//     Edit Profile screen — link row jumps there).
//     City/state come straight from the signed-in profile (set at signup),
//     so this row is always populated and never depends on an RPC.
//   - Discovery radius selector → profiles.discovery_radius_miles.
//     Options: 10 / 25 / 50 / 100 miles, or "Anywhere" (stored as 0).
//
// The radius IS consumed by the Discover feed as of migration 0026.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import {
  SettingsScaffold,
  SettingsGroup,
  GroupLabel,
  LinkRow,
  InfoRow,
  SettingsNote,
} from './SettingsKit';
import {
  fetchAccountSettings,
  saveDiscoveryRadius,
  DEFAULT_RADIUS,
} from '../../lib/accountSettings';

const RADIUS_OPTIONS = [
  { miles: 10,  label: '10 miles'  },
  { miles: 25,  label: '25 miles'  },
  { miles: 50,  label: '50 miles'  },
  { miles: 100, label: '100 miles' },
  { miles: 0,   label: 'Anywhere'  },
];

// Single-select row — checkmark on the active option. `last` is injected by
// SettingsGroup to drop the trailing divider.
function RadioRow({ label, selected, onPress, disabled, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowDivider]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {selected ? (
        <Ionicons name="checkmark" size={20} color={COLORS.sage} />
      ) : null}
    </TouchableOpacity>
  );
}

export default function LocationSettingsScreen({ navigation }) {
  const { profile } = useAuth();

  const [radius, setRadius]   = useState(DEFAULT_RADIUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // Only the radius needs an RPC. City/state come from the profile below.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { settings } = await fetchAccountSettings();
      if (alive) {
        setRadius(settings.radius);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const pickRadius = useCallback(async (miles) => {
    if (miles === radius) return;
    const prev = radius;
    setRadius(miles);
    setSaving(true);
    const { error } = await saveDiscoveryRadius(miles);
    setSaving(false);
    if (error) {
      setRadius(prev);
      Alert.alert('Could not save', 'Your change was not saved. Please try again.');
    }
  }, [radius]);

  // Sourced from the signed-in profile (captured at signup) — never empty
  // unless the user genuinely never entered a location.
  const locationValue =
    [profile?.city, profile?.state].filter(Boolean).join(', ') || 'Not set';

  return (
    <SettingsScaffold title="Location Settings" navigation={navigation} loading={loading}>
      <GroupLabel>Your location</GroupLabel>
      <SettingsGroup>
        <InfoRow iconName="navigate-outline" label="Current location" value={locationValue} />
        <LinkRow
          iconName="create-outline"
          label="Edit location"
          onPress={() => navigation?.navigate('EditProfile')}
        />
      </SettingsGroup>

      <GroupLabel>Discovery radius</GroupLabel>
      <SettingsGroup>
        {RADIUS_OPTIONS.map((opt) => (
          <RadioRow
            key={opt.miles}
            label={opt.label}
            selected={radius === opt.miles}
            onPress={() => pickRadius(opt.miles)}
            disabled={saving}
          />
        ))}
      </SettingsGroup>

      <SettingsNote>
        Discovery radius limits how far away people can be for you to see them
        in Discover. "Anywhere" removes the limit. People without a set location
        won't appear while a radius is active.
      </SettingsNote>
    </SettingsScaffold>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    minHeight: 52,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  rowLabel: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text },
});
