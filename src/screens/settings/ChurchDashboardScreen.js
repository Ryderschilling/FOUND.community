// ─────────────────────────────────────────────────────────────────────────
// ChurchDashboardScreen — Profile → Settings → My Church Dashboard
//
// The church-side B2B dashboard is not built yet. This screen is honest
// about that: it shows the member's linked church (if any) and lets a church
// leader request early access by email. No fake data, no fake controls.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useToast } from '../../components/ToastProvider';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  SettingsScaffold,
  SettingsGroup,
  GroupLabel,
  InfoRow,
  LinkRow,
  SettingsNote,
} from './SettingsKit';

const CONTACT_EMAIL = 'hello@found.community';

async function openMailto(subject, toast) {
  const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) throw new Error('no handler');
    await Linking.openURL(url);
  } catch {
    toast({ title: 'No email app', message: `Reach us at ${CONTACT_EMAIL}`, type: 'info' });
  }
}

export default function ChurchDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const toast = useToast();
  const [church, setChurch]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user?.id) { setLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('church:churches(id,name,city,state)')
        .eq('id', user.id)
        .maybeSingle();
      if (alive) {
        setChurch(data?.church ?? null);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const churchLocation = church
    ? [church.city, church.state].filter(Boolean).join(', ')
    : '';

  return (
    <SettingsScaffold title="My Church Dashboard" navigation={navigation} loading={loading}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="business" size={26} color={COLORS.sage} />
        </View>
        <Text style={styles.heroTitle}>Church Dashboard</Text>
        <Text style={styles.heroBody}>
          A space for church leaders to see their congregation on FOUND,
          welcome new members, and grow real community. It's in active
          development.
        </Text>
      </View>

      {church ? (
        <>
          <GroupLabel>Your church</GroupLabel>
          <SettingsGroup>
            <InfoRow iconName="home-outline" label={church.name}
              value={churchLocation || undefined} />
          </SettingsGroup>
        </>
      ) : (
        <>
          <GroupLabel>Your church</GroupLabel>
          <SettingsGroup>
            <LinkRow
              iconName="add-circle-outline"
              label="Link your church"
              onPress={() => navigation?.navigate('EditProfile')}
            />
          </SettingsGroup>
          <SettingsNote>
            You haven't linked a church yet. Add one on your profile so we can
            connect you when the dashboard launches.
          </SettingsNote>
        </>
      )}

      <GroupLabel>Early access</GroupLabel>
      <SettingsGroup>
        <LinkRow
          iconName="mail-outline"
          label="Request dashboard access"
          onPress={() =>
            openMailto(
              church
                ? `Church Dashboard access — ${church.name}`
                : 'Church Dashboard access request',
              toast
            )
          }
        />
      </SettingsGroup>

      <SettingsNote>
        Are you a pastor or church leader? Email us and we'll set you up with
        the dashboard the moment it's ready.
      </SettingsNote>
    </SettingsScaffold>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  heroTitle: {
    fontFamily: FONT.serifRegular,
    fontSize: 24,
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  heroBody: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
    textAlign: 'center',
  },
});
