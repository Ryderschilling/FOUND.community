// ─────────────────────────────────────────────────────────────────────────
// PrivacyScreen — Profile → Settings → Privacy
//
// Three toggles backed by profiles.privacy_prefs (jsonb). Optimistic saves.
//
// NOTE: `discoverable` is enforced once the Discover feed reads privacy_prefs;
// `show_church` / `show_location` control what other people see on your
// profile. The note below is honest about the current enforcement state.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  SettingsScaffold,
  SettingsGroup,
  GroupLabel,
  ToggleRow,
  SettingsNote,
} from './SettingsKit';
import {
  fetchAccountSettings,
  savePrivacyPrefs,
  DEFAULT_PRIVACY_PREFS,
} from '../../lib/accountSettings';

export default function PrivacyScreen({ navigation }) {
  const [prefs, setPrefs]     = useState(DEFAULT_PRIVACY_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { settings } = await fetchAccountSettings();
      if (alive) {
        setPrefs(settings.privacyPrefs);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const toggle = useCallback(async (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    const { error } = await savePrivacyPrefs(next);
    setSaving(false);
    if (error) {
      setPrefs(prefs);
      Alert.alert('Could not save', 'Your change was not saved. Please try again.');
    }
  }, [prefs]);

  return (
    <SettingsScaffold title="Privacy" navigation={navigation} loading={loading}>
      <GroupLabel>Discovery</GroupLabel>
      <SettingsGroup>
        <ToggleRow
          iconName="compass-outline"
          label="Discoverable"
          description="Let other members find you in Discover."
          value={prefs.discoverable}
          onValueChange={(v) => toggle('discoverable', v)}
          disabled={saving}
        />
      </SettingsGroup>

      <GroupLabel>Profile visibility</GroupLabel>
      <SettingsGroup>
        <ToggleRow
          iconName="business-outline"
          label="Show my church"
          description="Display your church on your public profile."
          value={prefs.show_church}
          onValueChange={(v) => toggle('show_church', v)}
          disabled={saving}
        />
        <ToggleRow
          iconName="location-outline"
          label="Show my location"
          description="Display your city and state on your profile."
          value={prefs.show_location}
          onValueChange={(v) => toggle('show_location', v)}
          disabled={saving}
        />
      </SettingsGroup>

      <SettingsNote>
        Turning off "Discoverable" hides you from new people in Discover.
        Existing connections can still see your profile and message you.
      </SettingsNote>
    </SettingsScaffold>
  );
}
