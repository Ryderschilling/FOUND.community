// ChurchProfileScreen
//
// App-side church profile. Members can:
//   - View full church info (logo, bio, service times, staff, groups)
//   - Message the church
//   - Follow / unfollow the church (to get notifications for new groups, etc.)
//
// All read data comes from get_church_profile RPC.
// Follow state comes from get_church_follow_status RPC.
// Church admins manage content from the dashboard; this screen is read-only.

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
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';

// Helpers

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
    .toUpperCase() || '?';
}

function formatDist(mi) {
  if (mi == null) return null;
  const n = Number(mi);
  if (!isFinite(n)) return null;
  if (n < 0.1) return '< 0.1 mi away';
  if (n < 10)  return `${n.toFixed(1)} mi away`;
  return `${Math.round(n)} mi away`;
}

function formatServiceTimes(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.map(t => `${t.day ?? ''} ${t.time ?? ''}`.trim()).filter(Boolean).join('  |  ');
    }
    if (typeof parsed === 'string') return parsed;
  } catch (_) {}
  return typeof raw === 'string' ? raw : null;
}

// Church logo — shows uploaded image or initials fallback

function ChurchLogo({ name, logoUrl, size = 88 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const radius = size / 2;

  if (logoUrl && !imgFailed) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={[styles.churchAvatar, { width: size, height: size, borderRadius: radius }]}
        onError={() => setImgFailed(true)}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={[styles.churchAvatar, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.churchInitials, { fontSize: size * 0.32 }]}>{initials(name)}</Text>
    </View>
  );
}

// Staff card

function StaffCard({ member }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <View style={styles.staffCard}>
      {member.avatar_url && !photoFailed ? (
        <Image
          source={{ uri: member.avatar_url }}
          style={styles.staffAvatar}
          onError={() => setPhotoFailed(true)}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.staffAvatar}>
          <Text style={styles.staffInitials}>{initials(member.name)}</Text>
        </View>
      )}
      <View style={styles.staffInfo}>
        <Text style={styles.staffName}>{member.name}</Text>
        {member.title ? <Text style={styles.staffTitle}>{member.title}</Text> : null}
        {member.bio   ? <Text style={styles.staffBio} numberOfLines={3}>{member.bio}</Text> : null}
      </View>
    </View>
  );
}

// Group card — tappable, navigates to GroupDetail

function GroupCard({ group, navigation }) {
  return (
    <TouchableOpacity
      style={styles.groupCard}
      activeOpacity={0.82}
      onPress={() => navigation?.navigate('GroupDetail', { groupId: group.id })}
    >
      <View style={styles.groupHeader}>
        <Text style={styles.groupName}>{group.name}</Text>
        <View style={styles.groupCardRight}>
          {group.member_count > 0 ? (
            <View style={styles.groupCountBadge}>
              <Ionicons name="people-outline" size={11} color={COLORS.textTertiary} />
              <Text style={styles.groupCountText}>{group.member_count}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
        </View>
      </View>
      {group.description ? (
        <Text style={styles.groupDesc} numberOfLines={2}>{group.description}</Text>
      ) : null}
      {group.schedule_text ? (
        <View style={styles.groupScheduleRow}>
          <Ionicons name="time-outline" size={13} color={COLORS.textTertiary} />
          <Text style={styles.groupScheduleText}>{group.schedule_text}</Text>
        </View>
      ) : null}
      {(group.city || group.state) ? (
        <View style={styles.groupScheduleRow}>
          <Ionicons name="location-outline" size={13} color={COLORS.textTertiary} />
          <Text style={styles.groupScheduleText}>
            {[group.city, group.state].filter(Boolean).join(', ')}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// Section header

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// Main screen

export default function ChurchProfileScreen({ navigation, route }) {
  const churchId      = route?.params?.churchId;
  const distanceMiles = route?.params?.distanceMiles ?? null;

  const [church, setChurch]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [isFollowing, setIsFollowing]     = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const load = useCallback(async () => {
    if (!churchId) { setError('No church ID provided.'); setLoading(false); return; }
    try {
      // Load church profile + follow status in parallel
      const [profileRes, followRes] = await Promise.all([
        supabase.rpc('get_church_profile', { p_church_id: churchId }),
        supabase.rpc('get_church_follow_status', { p_church_id: churchId }),
      ]);
      if (profileRes.error) throw profileRes.error;

      const row = Array.isArray(profileRes.data) ? profileRes.data[0] : profileRes.data;
      setChurch(row ?? null);
      setError(row ? null : 'Church not found.');

      if (!followRes.error && followRes.data) {
        const fs = typeof followRes.data === 'string'
          ? JSON.parse(followRes.data)
          : followRes.data;
        setIsFollowing(!!fs.is_following);
        setFollowerCount(Number(fs.follower_count) || 0);
      }
    } catch (e) {
      setError('Could not load church profile.');
    }
    setLoading(false);
  }, [churchId]);

  useEffect(() => { load(); }, [load]);

  async function handleFollow() {
    if (followLoading) return;
    setFollowLoading(true);
    // Optimistic
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setFollowerCount(c => wasFollowing ? Math.max(0, c - 1) : c + 1);

    try {
      const { data, error: rpcErr } = await supabase.rpc('toggle_church_follow', { p_church_id: churchId });
      if (rpcErr) {
        console.warn('[follow] RPC error:', rpcErr.message, rpcErr.code, rpcErr.details);
        throw rpcErr;
      }
      if (data == null) {
        console.warn('[follow] RPC returned null');
        throw new Error('null response');
      }
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      setIsFollowing(!!result.following);
      setFollowerCount(Number(result.follower_count) || 0);
    } catch (e) {
      console.warn('[follow] failed, reverting:', e?.message);
      // Revert on failure
      setIsFollowing(wasFollowing);
      setFollowerCount(c => wasFollowing ? c + 1 : Math.max(0, c - 1));
    }
    setFollowLoading(false);
  }

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
  const distLabel    = formatDist(distanceMiles);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.backRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation?.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.hero}>
          <ChurchLogo name={church.name} logoUrl={church.logo_url} size={90} />

          {church.is_verified ? (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={13} color={COLORS.sage} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          ) : null}

          <Text style={styles.churchName}>{church.name}</Text>

          <Text style={styles.churchMeta}>
            {[church.city, church.state].filter(Boolean).join(', ')}
            {church.denomination ? `  ·  ${church.denomination}` : ''}
          </Text>

          {distLabel ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={COLORS.textTertiary} />
              <Text style={styles.metaText}>{distLabel}</Text>
            </View>
          ) : null}

          {/* Stats row: members + followers */}
          <View style={styles.statsRow}>
            {church.member_count > 0 ? (
              <View style={styles.statChip}>
                <Ionicons name="people" size={13} color={COLORS.sage} />
                <Text style={styles.statChipText}>
                  {church.member_count} {church.member_count === 1 ? 'member' : 'members'}
                </Text>
              </View>
            ) : null}
            {followerCount > 0 ? (
              <View style={styles.statChip}>
                <Ionicons name="heart" size={12} color={COLORS.clay} />
                <Text style={styles.statChipText}>
                  {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          {/* Message Us */}
          <TouchableOpacity
            style={styles.messageBtn}
            activeOpacity={0.85}
            onPress={() => navigation?.navigate('ChurchInbox', {
              churchId: church.id,
              churchName: church.name,
            })}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={COLORS.accentText} />
            <Text style={styles.messageBtnText}>Message Us</Text>
          </TouchableOpacity>

          {/* Follow / Following */}
          <TouchableOpacity
            style={[styles.followBtn, isFollowing && styles.followBtnActive]}
            activeOpacity={0.82}
            onPress={handleFollow}
            disabled={followLoading}
          >
            <Ionicons
              name={isFollowing ? 'heart' : 'heart-outline'}
              size={16}
              color={isFollowing ? COLORS.clay : COLORS.text}
            />
            <Text style={[styles.followBtnText, isFollowing && styles.followBtnTextActive]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Follow explainer — shown only when not yet following */}
        {!isFollowing ? (
          <Text style={styles.followHint}>
            Follow to get notified when this church adds new groups or announcements.
          </Text>
        ) : null}

        {/* About */}
        {church.description ? (
          <Section title="About">
            <Text style={styles.description}>{church.description}</Text>
          </Section>
        ) : null}

        {/* Details */}
        {(serviceTimes || church.address || church.website) ? (
          <Section title="Details">
            <View style={styles.detailCard}>
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
                  style={[styles.detailRow, { borderBottomWidth: 0 }]}
                  onPress={() => Linking.openURL(church.website).catch(() => {})}
                  activeOpacity={0.7}
                >
                  <Ionicons name="globe-outline" size={16} color={COLORS.sage} />
                  <Text style={[styles.detailText, styles.detailLink]}>
                    {church.website.replace(/^https?:\/\//, '')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Section>
        ) : null}

        {/* Staff */}
        {staff.length > 0 ? (
          <Section title="Our Team">
            {staff.map((s, i) => <StaffCard key={s.id ?? i} member={s} />)}
          </Section>
        ) : null}

        {/* Groups */}
        {groups.length > 0 ? (
          <Section title={`Groups  (${groups.length})`}>
            {groups.map((g, i) => <GroupCard key={g.id ?? i} group={g} navigation={navigation} />)}
          </Section>
        ) : null}

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Styles

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: 4,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: SPACING.xl ?? 32,
  },
  errorTitle: { fontFamily: FONT.bold, fontSize: 17, color: COLORS.text, marginTop: 8 },
  errorBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textTertiary, textAlign: 'center' },

  scroll: { paddingHorizontal: SPACING.md },

  // Hero
  hero: { alignItems: 'center', paddingVertical: SPACING.lg, gap: 6 },
  churchAvatar: {
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 4, overflow: 'hidden',
  },
  churchInitials: { fontFamily: FONT.bold, color: COLORS.textSecondary },
  churchName: { fontFamily: FONT.bold, fontSize: 22, color: COLORS.text, textAlign: 'center' },
  churchMeta: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },

  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.sageBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99,
  },
  verifiedText: { fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.sage },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textTertiary },

  // Stats row (members + followers)
  statsRow: {
    flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4,
  },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    borderWidth: 1, borderColor: COLORS.border,
  },
  statChipText: { fontFamily: FONT.semiBold, fontSize: 12, color: COLORS.textSecondary },

  // Action buttons row
  actionRow: {
    flexDirection: 'row', gap: 10, marginBottom: 10,
  },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.accent, borderRadius: 99, paddingVertical: 14,
  },
  messageBtnText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.accentText },

  followBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 99, paddingVertical: 14, paddingHorizontal: 20,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  followBtnActive: {
    borderColor: COLORS.clay,
    backgroundColor: COLORS.clayBg,
  },
  followBtnText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  followBtnTextActive: { color: COLORS.clay },

  followHint: {
    fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary,
    textAlign: 'center', lineHeight: 17, marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
  },

  // Section
  section: { marginBottom: SPACING.lg },
  sectionTitle: {
    fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.textTertiary,
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: SPACING.sm,
  },

  // About
  description: {
    fontFamily: FONT.regular, fontSize: 15, color: COLORS.textSecondary, lineHeight: 23,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.borderLight,
  },

  // Details card
  detailCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.borderLight,
    paddingHorizontal: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight,
  },
  detailText: { flex: 1, fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, lineHeight: 20 },
  detailLink: { color: COLORS.sage },

  // Staff
  staffCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm,
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.borderLight,
    padding: SPACING.md, marginBottom: 8,
  },
  staffAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    overflow: 'hidden',
  },
  staffInitials: { fontFamily: FONT.semiBold, fontSize: 17, color: COLORS.textSecondary },
  staffInfo: { flex: 1, gap: 2 },
  staffName:  { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.text },
  staffTitle: { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.sage },
  staffBio:   { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginTop: 2 },

  // Groups
  groupCard: {
    backgroundColor: COLORS.white, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.borderLight,
    padding: SPACING.md, marginBottom: 8, gap: 5,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text, flex: 1 },
  groupCardRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  groupCountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.surface, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 99, borderWidth: 1, borderColor: COLORS.border,
  },
  groupCountText: { fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.textTertiary },
  groupDesc: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  groupScheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  groupScheduleText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textTertiary },
});
