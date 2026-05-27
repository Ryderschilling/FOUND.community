// ─────────────────────────────────────────────────────────────────────────
// HelpSupportScreen — Profile → Settings → Help & Support
//
// Fully real, no backend: an FAQ accordion, an email-support link, a website
// link, and the app version. Nothing here depends on a migration.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useToast } from '../../components/ToastProvider';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { COLORS, FONT, SPACING } from '../../theme';
import {
  SettingsScaffold,
  SettingsGroup,
  GroupLabel,
  LinkRow,
  InfoRow,
  SettingsNote,
} from './SettingsKit';

const CONTACT_EMAIL = 'hello@found.community';
const WEBSITE_URL   = 'https://found.community';
const APP_VERSION   = Constants.expoConfig?.version ?? '0.1.0';

const FAQ = [
  {
    q: 'How does Discover work?',
    a: 'Discover surfaces other FOUND members near you who share your faith and stage of life. Tap someone to see their full profile, then connect to start a conversation.',
  },
  {
    q: 'What does connecting with someone do?',
    a: 'Connecting opens a direct message thread between you two. It also adds them to your network, shown on your profile.',
  },
  {
    q: 'How do groups work?',
    a: 'Groups are local communities you can join. Members can post updates and photos to the group feed and chat together. Anyone viewing a group can see its activity.',
  },
  {
    q: 'Who can see my profile?',
    a: 'Other members can find you in Discover unless you turn off "Discoverable" in Privacy settings. You also control whether your church and location are shown.',
  },
  {
    q: 'How do I change my location?',
    a: 'Open Edit Profile from your profile screen. Your city and state come from your account and are used to find people near you.',
  },
];

async function openUrl(url, fallbackMsg, toast) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) throw new Error('no handler');
    await Linking.openURL(url);
  } catch {
    toast({ title: 'Could not open', message: fallbackMsg, type: 'error' });
  }
}

// Expand/collapse FAQ item. `last` injected by SettingsGroup to drop divider.
function FaqRow({ q, a, expanded, onToggle, last }) {
  return (
    <View style={[styles.faqRow, !last && styles.faqDivider]}>
      <TouchableOpacity
        style={styles.faqHead}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <Text style={styles.faqQ}>{q}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={COLORS.textTertiary}
        />
      </TouchableOpacity>
      {expanded ? <Text style={styles.faqA}>{a}</Text> : null}
    </View>
  );
}

export default function HelpSupportScreen({ navigation }) {
  const toast = useToast();
  const [openIdx, setOpenIdx] = useState(null);

  return (
    <SettingsScaffold title="Help & Support" navigation={navigation}>
      <GroupLabel>Frequently asked</GroupLabel>
      <SettingsGroup>
        {FAQ.map((item, i) => (
          <FaqRow
            key={item.q}
            q={item.q}
            a={item.a}
            expanded={openIdx === i}
            onToggle={() => setOpenIdx(openIdx === i ? null : i)}
          />
        ))}
      </SettingsGroup>

      <GroupLabel>Get in touch</GroupLabel>
      <SettingsGroup>
        <LinkRow
          iconName="mail-outline"
          label="Email support"
          value={CONTACT_EMAIL}
          onPress={() =>
            openUrl(
              `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('FOUND app support')}`,
              `Reach us at ${CONTACT_EMAIL}`,
              toast
            )
          }
        />
        <LinkRow
          iconName="globe-outline"
          label="Visit found.community"
          onPress={() => openUrl(WEBSITE_URL, `Visit ${WEBSITE_URL}`, toast)}
        />
      </SettingsGroup>

      <GroupLabel>About</GroupLabel>
      <SettingsGroup>
        <InfoRow iconName="information-circle-outline" label="App version" value={APP_VERSION} />
      </SettingsGroup>

      <SettingsNote>
        Found a bug or have an idea? Email us — every message goes straight to
        the team building FOUND.
      </SettingsNote>
    </SettingsScaffold>
  );
}

const styles = StyleSheet.create({
  faqRow: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
  },
  faqDivider: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  faqQ: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.text,
  },
  faqA: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginTop: SPACING.sm,
  },
});
