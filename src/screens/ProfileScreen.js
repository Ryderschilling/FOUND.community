import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Pill, SectionHeader } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { pickAndUploadAvatar } from '../lib/uploadAvatar';

// ─── Helpers ──────────────────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  ['#4A6FA5', '#2D4E8A'],
  ['#5A8A6A', '#3D6B55'],
  ['#C0795A', '#A0593A'],
  ['#7A5AA8', '#5A3A88'],
  ['#A8793A', '#886020'],
  ['#5A7A4A', '#3D6B3E'],
  ['#4A8A6A', '#2D6B55'],
  ['#7A846A', '#5A6450'],
];

function gradientFor(id) {
  if (!id) return AVATAR_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function initialsFor(name) {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase() || '··';
}

// ─── Sub-components ───────────────────────────────────────────────────────
function StatCard({ value, label }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const MAX_PHOTOS = 9;

function HighlightReel({ photos = [] }) {
  const slots = Array.from({ length: MAX_PHOTOS }, (_, i) => photos[i] ?? null);
  return (
    <View style={styles.reelGrid}>
      {slots.map((uri, i) => (
        <TouchableOpacity key={i} style={styles.reelSlot} activeOpacity={0.8}>
          {uri ? (
            <Image source={{ uri }} style={styles.reelImage} />
          ) : (
            <View style={styles.reelEmpty}>
              <Ionicons name="add" size={22} color={COLORS.textTertiary} />
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SettingsItem({ iconName, label, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.settingsItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.settingsIconWrap}>
        <Ionicons name={iconName} size={18} color={danger ? '#C0392B' : COLORS.textSecondary} />
      </View>
      <Text style={[styles.settingsLabel, danger && styles.settingsDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  const [profile, setProfile]     = useState(null);
  const [stats, setStats]         = useState({ matches: null, connections: null, groups: null });
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // Joined profile + taxonomy details, single round trip
      const profileQ = supabase
        .from('profiles')
        .select(`
          id, full_name, handle, bio, city, state, is_initiator, is_outgoing, avatar_url,
          life_stage:life_stages(id,label,icon,icon_color),
          church:churches(id,name,city,state),
          profile_activities(activity:activities(id,label,icon,icon_color))
        `)
        .eq('id', user.id)
        .maybeSingle();

      // Stats — three small head-only counts in parallel
      const connectionsQ = supabase
        .from('connections')
        .select('*', { count: 'exact', head: true })
        .eq('from_profile', user.id)
        .eq('kind', 'like');

      const groupsQ = supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id);

      const matchesQ = supabase.rpc('top_matches_detailed', { p_limit: 99 });

      const [pRes, cRes, gRes, mRes] = await Promise.all([
        profileQ,
        connectionsQ,
        groupsQ,
        matchesQ,
      ]);

      if (pRes.error) throw pRes.error;
      setProfile(pRes.data);
      setStats({
        matches:     mRes.error ? null : (mRes.data?.length ?? 0),
        connections: cRes.error ? null : (cRes.count ?? 0),
        groups:      gRes.error ? null : (gRes.count ?? 0),
      });
    } catch (e) {
      console.warn('[profile] load failed', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Avatar change flow ──────────────────────────────────────────────
  // Shows an action sheet, picks a photo, uploads to Supabase Storage,
  // updates profiles.avatar_url, and optimistically updates local state.
  async function runAvatarUpload(source) {
    if (uploadingAvatar || !user) return;
    setUploadingAvatar(true);
    const { url, error } = await pickAndUploadAvatar({ userId: user.id, source });
    setUploadingAvatar(false);
    if (error) {
      Alert.alert('Could not update photo', error.message || 'Try again.');
      return;
    }
    if (!url) return; // user cancelled — no-op
    // Optimistic local update (avoids a full reload roundtrip)
    setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
  }

  function handleChangeAvatar() {
    // On web: skip the action sheet (Alert.alert buttons don't fire on web
    // anyway) and go straight to the library — the browser file picker is
    // the same experience either way.
    if (Platform.OS === 'web') {
      runAvatarUpload('library');
      return;
    }
    Alert.alert(
      'Update profile photo',
      undefined,
      [
        { text: 'Take photo',          onPress: () => runAvatarUpload('camera')  },
        { text: 'Choose from library', onPress: () => runAvatarUpload('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // Placeholder for the "Edit" button next to the user's name. Full profile
  // editing (name, bio, location, interests) is post-MVP — for now we tell the
  // user where to go. Using window.alert on web because Alert.alert callbacks
  // don't fire there.
  function handleEditProfile() {
    const msg = 'Full profile editing is coming soon. For now, you can update your photo by tapping your avatar.';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(msg);
      return;
    }
    Alert.alert('Coming soon', msg);
  }

  async function handleSignOut() {
    const doSignOut = async () => {
      try { await signOut(); } catch (e) {
        Alert.alert('Sign out failed', e?.message ?? 'Try again.');
      }
    };
    // React Native Web ignores Alert.alert button callbacks — fall back to
    // window.confirm so the sign-out actually fires on the Vercel web build.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Sign out?\n\nYou can sign back in anytime.')) {
        doSignOut();
      }
      return;
    }
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel',   style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: doSignOut },
    ]);
  }

  if (loading || !profile) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.textTertiary} />
      </SafeAreaView>
    );
  }

  const name        = profile.full_name || profile.handle || 'You';
  const initials    = initialsFor(name);
  const grad        = gradientFor(profile.id);
  const locationStr = [profile.city, profile.state].filter(Boolean).join(', ') || 'Location not set';
  const interests   = (profile.profile_activities ?? [])
    .map((row) => row.activity)
    .filter(Boolean);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      >

        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={styles.headerMeta}>Your Account</Text>
          <Text style={styles.pageTitle}>Profile</Text>
        </View>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <TouchableOpacity
            onPress={handleChangeAvatar}
            activeOpacity={0.85}
            disabled={uploadingAvatar}
            style={styles.avatarWrap}
          >
            <Avatar
              initials={initials}
              size={68}
              gradientColors={grad}
              uri={profile.avatar_url || undefined}
            />
            {/* Camera badge overlay — signals avatar is tappable */}
            <View style={styles.avatarBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="camera" size={12} color={COLORS.white} />
              )}
            </View>
          </TouchableOpacity>
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{name}</Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={12} color={COLORS.textSecondary} />
              <Text style={styles.heroLocation}>{locationStr}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={handleEditProfile}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>

          {/* Stats */}
          <View style={styles.statsRow}>
            <StatCard value={stats.matches}     label="Matches"   />
            <StatCard value={stats.connections} label="Connected" />
            <StatCard value={stats.groups}      label="Groups"    />
          </View>

          {/* Bio */}
          {profile.bio ? (
            <View style={styles.section}>
              <SectionHeader label="About" />
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>{profile.bio}</Text>
              </View>
            </View>
          ) : null}

          {/* Life stage */}
          {profile.life_stage ? (
            <View style={styles.section}>
              <SectionHeader label="Life Stage" />
              <View style={styles.lifeStageCard}>
                <Ionicons
                  name={profile.life_stage.icon || 'person-outline'}
                  size={20}
                  color={profile.life_stage.icon_color ?? COLORS.textSecondary}
                />
                <Text style={styles.lifeStageText}>{profile.life_stage.label}</Text>
              </View>
            </View>
          ) : null}

          {/* Interests */}
          {interests.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label="Interests" action="Edit" onAction={handleEditProfile} />
              <View style={styles.pillsWrap}>
                {interests.map((i) => (
                  <Pill key={i.id} label={i.label} variant="neutral" />
                ))}
              </View>
            </View>
          ) : null}

          {/* Church */}
          {profile.church ? (
            <View style={styles.section}>
              <SectionHeader label="Church" />
              <View style={styles.churchCard}>
                <View style={styles.churchIconWrap}>
                  <Ionicons name="business-outline" size={22} color={COLORS.sage} />
                </View>
                <View>
                  <Text style={styles.churchName}>{profile.church.name}</Text>
                  <Text style={styles.churchMeta}>
                    {[profile.church.city, profile.church.state].filter(Boolean).join(', ')}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Highlight Reel — UI shell only; photos wiring is next pass */}
          <View style={styles.section}>
            <SectionHeader label="Your Highlight Reel" action="Edit" onAction={handleEditProfile} />
            <HighlightReel photos={[]} />
          </View>

          {/* Settings */}
          <View style={styles.section}>
            <SectionHeader label="Settings" />
            <View style={styles.settingsGroup}>
              <SettingsItem iconName="notifications-outline" label="Notifications"       />
              <SettingsItem iconName="location-outline"      label="Location Settings"   />
              <SettingsItem iconName="lock-closed-outline"   label="Privacy"             />
              <SettingsItem iconName="business-outline"      label="My Church Dashboard" />
              <SettingsItem iconName="help-circle-outline"   label="Help & Support"      />
              <SettingsItem iconName="log-out-outline"       label="Sign Out" danger onPress={handleSignOut} />
            </View>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  pageHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerMeta: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 3,
  },
  pageTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  avatarWrap: { position: 'relative' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  heroInfo: { flex: 1, gap: 3 },
  heroName: { fontFamily: FONT.serifItalic, fontSize: 20, color: COLORS.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroLocation: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },
  editBtn: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  editBtnText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.textSecondary },

  content: { paddingHorizontal: SPACING.lg, gap: SPACING.lg },

  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  statValue: { fontFamily: FONT.serifItalic, fontSize: 28, color: COLORS.text },
  statLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  section: { gap: SPACING.sm },

  bioCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bioText: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.text, lineHeight: 20 },

  lifeStageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lifeStageText: { fontFamily: FONT.medium, fontSize: 15, color: COLORS.text },

  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  churchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  churchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  churchName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  churchMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  settingsGroup: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    ...SHADOW.sm,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  settingsIconWrap: { width: 24, alignItems: 'center' },
  settingsLabel: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, flex: 1 },
  settingsDanger: { color: '#C0392B' },

  // Highlight Reel
  reelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reelSlot: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  reelImage: {
    width: '100%',
    height: '100%',
  },
  reelEmpty: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
