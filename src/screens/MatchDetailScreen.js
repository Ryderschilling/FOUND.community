// ─────────────────────────────────────────────────────────────────────────
// MatchDetailScreen — full profile view for any person in the app.
//
// Called from:
//   • Discover feed (top_matches_detailed) — comes with score + interests
//   • HomeScreen InboundStrip              — comes with slim inbound row
//   • ActivityScreen rows                  — also slim inbound data
//
// When the passed match object is "slim" (no matchScore / no interests), this
// screen fetches the full profile via get_profile_detail() on mount so every
// entrypoint always shows a complete, consistent view.
//
// CTA bar adapts based on relationship state:
//   theirKind set + not yet connected → Accept / Ignore (inbound request)
//   connected + isMatch               → ✓ Connected  (mutual)
//   connected + not isMatch           → ⏱ Pending
//   default                           → Connect
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Pill, SectionHeader, RuleLabel } from '../components/Atoms';
import ScoreRing from '../components/ScoreRing';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { fetchProfilePhotos } from '../lib/profilePhotos';
import HighlightReelView from '../components/HighlightReelView';
import { useConfirm } from '../components/ConfirmProvider';

export default function MatchDetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const initialMatch = route?.params?.match ?? FALLBACK_MATCH;

  // ── Local state ──────────────────────────────────────────────────────────
  const [connected,    setConnected]    = useState(initialMatch.connected ?? false);
  const [saved,        setSaved]        = useState(initialMatch.saved ?? false);
  const [isMatch,      setIsMatch]      = useState(initialMatch.isMatch ?? false);
  const [theirKind,    setTheirKind]    = useState(initialMatch.theirKind ?? null);
  const [photos,       setPhotos]       = useState([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [openingChat,  setOpeningChat]  = useState(false);
  const [ignoring,     setIgnoring]     = useState(false);

  // Full profile data — starts from whatever the caller passed, enriched by
  // get_profile_detail() when score / interests are missing.
  const [profile, setProfile] = useState({
    id:              initialMatch.id,
    name:            initialMatch.name,
    handle:          initialMatch.handle   ?? null,
    bio:             initialMatch.bio      ?? null,
    initials:        initialMatch.initials,
    avatarUrl:       initialMatch.avatarUrl ?? null,
    avatarColor:     initialMatch.avatarColor,
    matchScore:      initialMatch.matchScore ?? null,
    lifeStage:       initialMatch.lifeStage  ?? '',
    distance:        initialMatch.distance   ?? '',
    church:          initialMatch.church     ?? null,
    interests:       initialMatch.interests  ?? [],
    connectionCount: null,
    groupCount:      null,
  });

  const needsFetch = initialMatch.matchScore === null || (initialMatch.interests ?? []).length === 0;
  const [detailLoading, setDetailLoading] = useState(needsFetch);

  const confirm    = useConfirm();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── Fetch full detail when caller didn't provide it ─────────────────────
  useEffect(() => {
    if (!initialMatch.id || !needsFetch) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('get_profile_detail', {
        p_profile: initialMatch.id,
      });
      if (cancelled) return;
      if (error) {
        console.warn('[match] get_profile_detail failed', error.message);
        setDetailLoading(false);
        return;
      }
      const d = Array.isArray(data) ? data[0] : data;
      if (!d) { setDetailLoading(false); return; }

      setProfile((prev) => ({
        ...prev,
        bio:             d.bio              ?? prev.bio,
        lifeStage:       d.life_stage_label ?? prev.lifeStage,
        distance:        d.city && d.state ? `${d.city}, ${d.state}` : prev.distance,
        church:          d.church_name     ?? prev.church,
        matchScore:      d.score           ?? prev.matchScore,
        interests:       (d.activities ?? []).map((a) => ({
                           id: a.id, label: a.label, icon: a.icon,
                         })),
        connectionCount: d.connection_count ?? null,
        groupCount:      d.group_count      ?? null,
      }));

      // Sync live relationship state
      setConnected(d.my_kind === 'like');
      setIsMatch(!!d.is_match);
      setTheirKind(d.their_kind ?? null);
      setDetailLoading(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMatch.id]);

  // ── Highlight reel ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialMatch.id) return;
    let cancelled = false;
    (async () => {
      const { photos: rows, error } = await fetchProfilePhotos(initialMatch.id);
      if (cancelled) return;
      if (error) console.warn('[match] photos fetch failed', error.message);
      else setPhotos(rows);
      setPhotosLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [initialMatch.id]);

  // ── Sync saved state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !initialMatch.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('saved_profiles')
        .select('saved_id')
        .eq('saver_id', user.id)
        .eq('saved_id', initialMatch.id)
        .maybeSingle();
      if (cancelled) return;
      if (!error) setSaved(!!data);
    })();
    return () => { cancelled = true; };
  }, [user, initialMatch.id]);

  // ── CTA state ────────────────────────────────────────────────────────────
  // isInbound: they sent me a request I haven't accepted/matched yet
  const isInbound = (theirKind === 'like' || theirKind === 'wave') && !connected && !isMatch;
  const ctaState  = isMatch ? 'connected' : (connected ? 'pending' : 'idle');

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (connected || !user || !profile.id) return;
    setConnected(true);
    const { error } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: profile.id, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (!mountedRef.current) return;
    if (error) {
      setConnected(false);
      Alert.alert('Could not connect', error.message);
      return;
    }
    if (theirKind === 'like') {
      setIsMatch(true);
      const ok = await confirm({
        title: 'FOUND!',
        message: `You and ${profile.name.split(' ')[0]} are now connected. Say hi?`,
        confirmLabel: 'Send a message',
        cancelLabel: 'Later',
      });
      if (ok && mountedRef.current) handleOpenChat();
    }
  }

  async function handleIgnore() {
    if (!user || !profile.id) return;
    setIgnoring(true);
    await supabase.rpc('dismiss_inbound', { p_from: profile.id });
    if (!mountedRef.current) return;
    setIgnoring(false);
    navigation.goBack();
  }

  async function handleSave() {
    if (saved || !user || !profile.id) return;
    setSaved(true);
    const { error } = await supabase
      .from('saved_profiles')
      .upsert(
        { saver_id: user.id, saved_id: profile.id },
        { onConflict: 'saver_id,saved_id', ignoreDuplicates: true }
      );
    if (!mountedRef.current) return;
    if (error) { setSaved(false); }
  }

  async function handleUnsave() {
    if (!saved || !user || !profile.id) return;
    setSaved(false);
    const { error } = await supabase
      .from('saved_profiles')
      .delete()
      .eq('saver_id', user.id)
      .eq('saved_id', profile.id);
    if (!mountedRef.current) return;
    if (error) { setSaved(true); }
  }

  async function doDisconnect() {
    if (!user || !profile.id) return;
    setConnected(false); setIsMatch(false);
    const { error } = await supabase.rpc('remove_connection', {
      p_other: profile.id,
      p_kind:  'like',
    });
    if (!mountedRef.current) return;
    if (error) {
      setConnected(true);
      Alert.alert('Could not undo', error.message);
    }
  }

  async function handleConnectTap() {
    if (ctaState === 'idle') return handleConnect();
    if (ctaState === 'pending') {
      const ok = await confirm({
        title: 'Cancel request?',
        message: `${profile.name} won't see your connection request anymore.`,
        confirmLabel: 'Cancel request',
        destructive: true,
      });
      if (ok) doDisconnect();
      return;
    }
    if (ctaState === 'connected') {
      const ok = await confirm({
        title: 'Disconnect?',
        message: `You and ${profile.name} will no longer be connected.`,
        confirmLabel: 'Disconnect',
        destructive: true,
      });
      if (ok) doDisconnect();
    }
  }

  async function handleOpenChat() {
    if (openingChat || !user || !profile.id) return;
    setOpeningChat(true);
    try {
      const { data: threadId, error } = await supabase
        .rpc('start_direct_thread', { p_other: profile.id });
      if (error) throw error;
      navigation.navigate('Chat', {
        thread_id: threadId,
        other: {
          id:          profile.id,
          name:        profile.name,
          initials:    profile.initials,
          avatarColor: profile.avatarColor,
        },
      });
    } catch (e) {
      Alert.alert('Could not open chat', e?.message ?? 'Try again.');
    } finally {
      if (mountedRef.current) setOpeningChat(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>

        {/* Hero */}
        <View style={styles.hero}>
          <Avatar
            initials={profile.initials}
            size={96}
            gradientColors={profile.avatarColor ?? [COLORS.sage, COLORS.clay]}
            uri={profile.avatarUrl || undefined}
            style={styles.avatar}
          />

          <View style={styles.scoreWrap}>
            {detailLoading ? (
              <View style={styles.scoreLoadingWrap}>
                <ActivityIndicator size="small" color={COLORS.textTertiary} />
              </View>
            ) : (
              <ScoreRing score={profile.matchScore} size={64} stroke={5} />
            )}
          </View>

          <Text style={styles.heroName}>{profile.name}</Text>
          <Text style={styles.heroMeta}>
            {[profile.lifeStage, profile.distance].filter(Boolean).join(' · ')}
          </Text>

          {profile.church ? (
            <View style={styles.churchRow}>
              <Ionicons name="business-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.churchText}>{profile.church}</Text>
            </View>
          ) : null}

          {/* Connection + group count chips */}
          {(profile.connectionCount !== null || profile.groupCount !== null) ? (
            <View style={styles.statsRow}>
              {profile.connectionCount !== null ? (
                <View style={styles.statChip}>
                  <Ionicons name="people-outline" size={13} color={COLORS.textSecondary} />
                  <Text style={styles.statText}>{profile.connectionCount} connected</Text>
                </View>
              ) : null}
              {profile.groupCount !== null ? (
                <View style={styles.statChip}>
                  <Ionicons name="grid-outline" size={13} color={COLORS.textSecondary} />
                  <Text style={styles.statText}>
                    {profile.groupCount} group{profile.groupCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={styles.content}>

          {/* Highlight Reel */}
          {photos.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label="Highlight Reel" />
              <HighlightReelView photos={photos} sideInset={SPACING.lg} />
            </View>
          ) : photosLoaded ? (
            <View style={styles.section}>
              <SectionHeader label="Highlight Reel" />
              <View style={styles.reelEmpty}>
                <Ionicons name="images-outline" size={22} color={COLORS.textTertiary} />
                <Text style={styles.reelEmptyText}>
                  {profile.name?.split(' ')[0] || 'They'} hasn't added any photos yet.
                </Text>
              </View>
            </View>
          ) : null}

          {/* About */}
          {profile.bio ? (
            <View style={styles.section}>
              <SectionHeader label="About" />
              <Text style={styles.bioText}>{profile.bio}</Text>
            </View>
          ) : null}

          {/* Interests */}
          {detailLoading ? (
            <View style={styles.section}>
              <SectionHeader label="Interests" />
              <ActivityIndicator color={COLORS.textTertiary} style={{ marginTop: 8 }} />
            </View>
          ) : profile.interests.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label="Interests" />
              <View style={styles.pillsWrap}>
                {profile.interests.map((i) => (
                  <Pill key={i.id} label={i.label} variant="neutral" />
                ))}
              </View>
            </View>
          ) : null}

          {/* In Common */}
          <View style={styles.section}>
            <SectionHeader label="In Common" />
            <View style={styles.commonCard}>
              {profile.lifeStage ? (
                <View style={styles.commonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                  <Text style={styles.commonText}>Same life stage</Text>
                </View>
              ) : null}
              {profile.church ? (
                <View style={styles.commonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                  <Text style={styles.commonText}>Nearby church</Text>
                </View>
              ) : null}
              {profile.interests.slice(0, 2).map((i) => (
                <View key={i.id} style={styles.commonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                  <Text style={styles.commonText}>Both into {i.label.toLowerCase()}</Text>
                </View>
              ))}
              {!profile.lifeStage && !profile.church && profile.interests.length === 0 && !detailLoading ? (
                <View style={styles.commonRow}>
                  <Ionicons name="sparkles-outline" size={16} color={COLORS.textTertiary} />
                  <Text style={[styles.commonText, { color: COLORS.textSecondary }]}>
                    Connect to see what you have in common
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

        </View>
      </ScrollView>

      {/* ── Sticky bottom dock ───────────────────────────────────────────── */}
      <View style={styles.bottomDock}>
        <RuleLabel
          label={isInbound ? 'accept · ignore · message' : 'connect · save · message'}
          style={styles.rule}
        />
        <View style={styles.ctaBar}>

          {isInbound ? (
            <>
              {/* Accept */}
              <TouchableOpacity
                style={styles.btnAccept}
                onPress={handleConnect}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark" size={16} color={COLORS.white} />
                <Text style={styles.btnAcceptText}>Accept</Text>
              </TouchableOpacity>

              {/* Ignore */}
              <TouchableOpacity
                style={styles.btnIgnore}
                onPress={handleIgnore}
                disabled={ignoring}
                activeOpacity={0.8}
              >
                {ignoring
                  ? <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  : <Text style={styles.btnIgnoreText}>Ignore</Text>}
              </TouchableOpacity>

              {/* Message */}
              <TouchableOpacity
                style={styles.btnMessage}
                onPress={handleOpenChat}
                disabled={openingChat}
                activeOpacity={0.8}
              >
                {openingChat
                  ? <ActivityIndicator color={COLORS.text} size="small" />
                  : <Ionicons name="chatbubble-outline" size={20} color={COLORS.text} />}
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Save */}
              <TouchableOpacity
                style={[styles.btnSave, saved && styles.btnSaveDone]}
                onPress={() => saved ? handleUnsave() : handleSave()}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={saved ? 'bookmark' : 'bookmark-outline'}
                  size={20}
                  color={saved ? COLORS.sage : COLORS.textSecondary}
                />
              </TouchableOpacity>

              {/* Connect */}
              <TouchableOpacity
                style={[
                  styles.btnConnect,
                  ctaState === 'pending'   && styles.btnConnectPending,
                  ctaState === 'connected' && styles.btnConnectDone,
                ]}
                onPress={handleConnectTap}
                activeOpacity={0.85}
              >
                <Text style={[
                  styles.btnConnectText,
                  ctaState === 'pending'   && styles.btnConnectTextPending,
                  ctaState === 'connected' && styles.btnConnectTextDone,
                ]}>
                  {ctaState === 'connected' ? '✓  Connected'
                   : ctaState === 'pending' ? '⏱  Pending'
                   : 'Connect'}
                </Text>
              </TouchableOpacity>

              {/* Message */}
              <TouchableOpacity
                style={styles.btnMessage}
                onPress={handleOpenChat}
                disabled={openingChat}
                activeOpacity={0.8}
              >
                {openingChat
                  ? <ActivityIndicator color={COLORS.text} size="small" />
                  : <Ionicons name="chatbubble-outline" size={20} color={COLORS.text} />}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Fallback ─────────────────────────────────────────────────────────────
const FALLBACK_MATCH = {
  id: '0',
  name: 'Sarah M.',
  initials: 'SM',
  avatarColor: ['#7B9E6B', '#B87155'],
  matchScore: 87,
  lifeStage: 'Young Professional',
  distance: '0.8 mi',
  church: 'Seaside Community Church',
  interests: [
    { id: 'hiking', label: 'Hiking',      icon: 'walk-outline'          },
    { id: 'music',  label: 'Music',       icon: 'musical-notes-outline' },
    { id: 'coffee', label: 'Coffee',      icon: 'cafe-outline'          },
    { id: 'bible',  label: 'Bible Study', icon: 'book-outline'          },
  ],
};

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  nav: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  backBtn: {
    width: 40, height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  backArrow: { fontSize: 20, color: COLORS.text },

  // Hero
  hero: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    position: 'relative',
  },
  avatar: { ...SHADOW.md },
  scoreWrap: {
    position: 'absolute',
    top: SPACING.xl + 60,
    right: '28%',
  },
  scoreLoadingWrap: {
    width: 64, height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: SPACING.md,
    marginBottom: 4,
  },
  heroMeta: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary },
  churchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  churchText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },

  statsRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.md },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statText: { fontFamily: FONT.semiBold, fontSize: 12, color: COLORS.textSecondary },

  // Content
  content: { paddingHorizontal: SPACING.lg, gap: SPACING.lg },
  section: { gap: SPACING.sm },
  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reelEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.md,
  },
  reelEmptyText: { flex: 1, fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary },
  bioText: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, lineHeight: 23 },
  commonCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: 10,
  },
  commonRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  commonText: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.text },

  rule: { marginBottom: SPACING.sm },

  // Bottom dock
  bottomDock: { position: 'absolute', bottom: 24, left: SPACING.lg, right: SPACING.lg },
  ctaBar: {
    flexDirection: 'row', gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.lg,
  },

  // Inbound mode: Accept / Ignore
  btnAccept: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: COLORS.accent, borderRadius: RADIUS.lg, height: 50,
  },
  btnAcceptText: { fontFamily: FONT.bold, fontSize: 15, color: COLORS.white },
  btnIgnore: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bg, borderRadius: RADIUS.lg, height: 50,
    borderWidth: 1, borderColor: COLORS.border,
  },
  btnIgnoreText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.textSecondary },

  // Normal mode: Save / Connect / Message
  btnSave: {
    width: 50, height: 50, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSaveDone: { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageLight },
  btnConnect: {
    flex: 1, backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', height: 50,
  },
  btnConnectDone:    { backgroundColor: COLORS.sageBg, borderWidth: 1, borderColor: COLORS.sageMid },
  btnConnectPending: { backgroundColor: COLORS.goldBg, borderWidth: 1, borderColor: COLORS.gold },
  btnConnectText:        { fontFamily: FONT.bold, fontSize: 15, color: COLORS.white },
  btnConnectTextDone:    { color: COLORS.sage },
  btnConnectTextPending: { color: COLORS.gold },
  btnMessage: {
    width: 50, height: 50, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
