// ─────────────────────────────────────────────────────────────────────────
// NotificationsScreen — Profile → Settings → Notifications
//
// Four toggles backed by profiles.notification_prefs (jsonb). Saves are
// optimistic: the switch flips immediately, then persists; on failure the
// switch reverts and an alert explains why.
//
// NOTE: these preferences persist, but push/email *delivery* is not wired
// yet. The SettingsNote at the bottom says so honestly.
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
  saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
} from '../../lib/accountSettings';

export default function NotificationsScreen({ navigation }) {
  const [prefs, setPrefs]     = useState(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { settings } = await fetchAccountSettings();
      if (alive) {
        setPrefs(settings.notificationPrefs);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Optimistic toggle: flip locally, persist, revert on error.
  const toggle = useCallback(async (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    const { error } = await saveNotificationPrefs(next);
    setSaving(false);
    if (error) {
      setPrefs(prefs); // revert
      Alert.alert('Could not save', 'Your change was not saved. Please try again.');
    }
  }, [prefs]);

  return (
    <SettingsScaffold title="Notifications" navigation={navigation} loading={loading}>
      <GroupLabel>People</GroupLabel>
      <SettingsGroup>
        <ToggleRow
          iconName="chatbubble-outline"
          label="New messages"
          description="When someone sends you a direct message."
          value={prefs.new_messages}
          onValueChange={(v) => toggle('new_messages', v)}
          disabled={saving}
        />
        <ToggleRow
          iconName="people-outline"
          label="Connections"
          description="When someone connects with you."
          value={prefs.connections}
          onValueChange={(v) => toggle('connections', v)}
          disabled={saving}
        />
      </SettingsGroup>

      <GroupLabel>Groups</GroupLabel>
      <SettingsGroup>
        <ToggleRow
          iconName="newspaper-outline"
          label="Group posts"
          description="When a group you're in has new activity."
          value={prefs.group_posts}
          onValueChange={(v) => toggle('group_posts', v)}
          disabled={saving}
        />
        <ToggleRow
          iconName="mail-outline"
          label="Group messages"
          description="When there's a new message in a group chat."
          value={prefs.group_messages}
          onValueChange={(v) => toggle('group_messages', v)}
          disabled={saving}
        />
      </SettingsGroup>

      <SettingsNote>
        These preferences are saved to your account. Push and email delivery
        are still being built — turning a toggle off now makes sure you won't
        be notified once delivery goes live.
      </SettingsNote>
    </SettingsScaffold>
  );
}
