// ─────────────────────────────────────────────────────────────────────────────
// ChurchProfileScreen
//
// The app-side church profile. Rendered when:
//   - A member taps a church_welcome notification
//   - A member taps the church name on their own profile or a match's profile
//   - A member browses to their church from the church picker
//
// All data comes from the `get_church_profile` RPC — a single call that
// returns the church row + staff array + groups array + member count.
//
// Church admins manage everything from the dashboard; this screen is read-only.
// The only action a member can take here is "Message Us" → ChurchInboxScreen.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
    .toUpperCase() || '?';
}

function lifeStageLabel(s) {
  const MAP = { single: 'Single', dating: 'Dating', engaged: 'Engaged', married: 'Married', parents: 'Parents', empty_nest: 'Empty Nest' };
  return MAP[s] || s || '';
}

// Parse service_times — stored as jsonb in DB (array of {day, time} objects or a plain string).
function formatServiceTimes(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.map(t => `${t.day ?? ''} ${t.time ?? ''}`.trim()).filter(Boolean).join('  ·  ');
    }
    if (typeof parsed === 'string') return parsed;
  } catch (_) {}
  return typeof raw === 'string' ? raw : null;
}

// ─── Staff Card ────────────────────────────────────────────────────────────────

function StaffCard({ member }) {
  return (
    <View style={styles.staffCard}>
      <View style={styles.staffAvatar}>
        <Text style={styles.staffInitials}>{initials(member.name)}</Text>
      </View>
      <View style={styles.staffInfo}>
        <Text style={styles.staffName}>{member.name}</Text>
        {member.title ? <Text style={styles.staffTitle}>{member.title}</Text> : null}
        {member.bio   ? <Text style={styles.staffBio} numberOfLines={2}>{member.bio}</Text> : null}
      </View>
    </View>
  );
}

// ─── Group Chip ────────────────────────────────────────────────────────────────

function GroupChip({ group }) {
  return (
    <View style={styles.groupChip}>
      <Text style={styles.groupName}>{group.name}</Text>
      {group.schedule_text ? (
        <Text style={styles.groupSchedule}>{group.schedule_text}</Text>
      ) : null}
      {group.member_count > 0 ? (
        <Text style={styles.groupCount}>{group.member_count} members</Text>
      ) : null}
    </View>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChurchProfileScreen({ navigation, route }) {
  const churchId = route?.params?.churchId;

  const [church, setChurch]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!churchId) { setError('No church ID provided.'); setLoading(false); return; }
    try {
      const { data, error: err } = await supabase.rpc('get_church_profile', { p_church_id: churchId });
      if (err) throw err;
      const row = Array.isArray(data) ? data[0] : data;
      setChurch(row ?? null);
      setError(row ? null : 'Church not found.');
    } catch (e) {
      setError('Could not load church profile.');
    }
    setLoading(false);
  }, [churchId]);

  useEffect(() => { load(); }, [load]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        <View style={styles.backRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !church) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        <View style={styles.backRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.center}>
          <Ionicons name="business-outline" size={32} color={COLORS.textTertiary} />
          <Text style={styles.errorTitle}>Church not found</Text>
          <Text style={styles.errorBody}>{error || 'This church may have been removed.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const staff  = Array.isArray(church.staff)  ? church.staff  : [];
  const groups = Array.isArray(church.groups) ? church.groups : [];
  const serviceTimes = formatServiceTimes(church.service_times);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header row */}
      <View style={styles.backRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation?.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <View style={styles.churchAvatar}>
            <Text style={styles.churchInitials}>{initials(church.name)}</Text>
          </View>
          <Text style={styles.churchName}>{church.name}</Text>

          {/* Location + denomination */}
          <Text style={styles.churchMeta}>
            {[church.city, church.state].filter(Boolean).join(', ')}
            {church.denomination ? `  ·  ${church.denomination}` : ''}
          </Text>

          {/* Member count */}
          {church.member_count > 0 ? (
            <View style={styles.memberBadge}>
              <Ionicons name="people" size={13} color={COLORS.sage} />
              <Text style={styles.memberBadgeText}>
                {church.member_count} {church.member_count === 1 ? 'FOUND member' : 'FOUND members'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Message Us CTA ────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.messageBtn}
          activeOpacity={0.85}
          onPress={() => navigation?.navigate('ChurchInbox', {
            churchId: church.id,
            churchName: church.name,
          })}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.accentText} />
          <Text style={styles.messageBtnText}>Message Us</Text>
        </TouchableOpacity>

        {/* ── About ────────────────────────────────────────────────────── */}
        {church.description ? (
          <Section title="About">
            <Text style={styles.description}>{church.description}</Text>
          </Section>
        ) : null}

        {/* ── Details ──────────────────────────────────────────────────── */}
        {(serviceTimes || church.address || church.website) ? (
          <Section title="Details">
            {serviceTimes ? (
              <View style={styles.detailRow}>
                <Ionicons name="time-outline" size={16} color={COLORS.textTertiary} />
                <Text style={styles.detailText}>{serviceTimes}</Text>
              </View>
            ) : null}
            {church.address ? (
              <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={16} color={COLORS.textTertiary} />
                <Text style={styles.detailText}>{church.address}</Text>
              </View>
            ) : null}
            {church.website ? (
              <TouchableOpacity
                style={styles.detailRow}
                onPress={() => Linking.openURL(church.website).catch(() => {})}
                activeOpacity={0.7}
              >
                <Ionicons name="globe-outline" size={16} color={COLORS.sage} />
                <Text style={[styles.detailText, styles.detailLink]}>
                  {church.website.replace(/^https?:\/\//, '')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </Section>
        ) : null}

        {/* ── Staff ────────────────────────────────────────────────────── */}
        {staff.length > 0 ? (
          <Section title="Our Team">
            {staff.map((s) => <StaffCard key={s.id} member={s} />)}
          </Section>
        ) : null}

        {/* ── Groups ───────────────────────────────────────────────────── */}
        {groups.length > 0 ? (
          <Section title="Groups">
            {groups.map((g) => <GroupChip key={g.id} group={g} />)}
          </Section>
        ) : null}

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs ?? 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: SPACING.xl ?? 32,
  },
  errorTitle: { fontFamily: FONT.bold, fontSize: 17, color: COLORS.text, marginTop: 8 },
  errorBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textTertiary, textAlign: 'center' },

  scroll: { paddingHorizontal: SPACING.md },

  // Hero
  hero: { alignItems: 'center', paddingVertical: SPACING.lg ?? 24, gap: 6 },
  churchAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 4,
  },
  churchInitials: { fontFamily: FONT.bold, fontSize: 28, color: COLORS.textSecondary },
  churchName: { fontFamily: FONT.bold, fontSize: 22, color: COLORS.text, textAlign: 'center' },
  churchMeta: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.sageBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 2,
  },
  memberBadgeText: { fontFamily: FONT.semiBold, fontSize: 12, color: COLORS.sage },

  // CTA
  messageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 99,
    paddingVertical: 14,
    marginBottom: SPACING.lg ?? 24,
  },
  messageBtnText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.accentText },

  // Section
  section: { marginBottom: SPACING.lg ?? 24 },
  sectionTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm ?? 8,
  },

  // About
  description: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 23,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg ?? 16,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },

  // Details
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  detailText: { flex: 1, fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },
  detailLink: { color: COLORS.sage },

  // Staff
  staffCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm ?? 8,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.md,
    marginBottom: 8,
  },
  staffAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  staffInitials: { fontFamily: FONT.semiBold, fontSize: 16, color: COLORS.textSecondary },
  staffInfo: { flex: 1, gap: 2 },
  staffName:   { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.text },
  staffTitle:  { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.sage },
  staffBio:    { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginTop: 2 },

  // Groups
  groupChip: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.md,
    marginBottom: 8,
    gap: 3,
  },
  groupName:     { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.text },
  groupSchedule: { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.textSecondary },
  groupCount:    { fontFamily: FONT.regular,  fontSize: 12, color: COLORS.textTertiary },
});
