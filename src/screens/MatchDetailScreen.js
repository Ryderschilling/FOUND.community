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
  Modal,
  Platform,
  Image,
  Dimensions,
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
import { useToast } from '../components/ToastProvider';
import ReportSheet from '../components/ReportSheet';
import { LOVE_LANGUAGES, COMMUNITY_GOALS } from '../data/mock';

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
  const [openingChat,     setOpeningChat]     = useState(false);
  const [ignoring,        setIgnoring]        = useState(false);
  const [moreMenuOpen,    setMoreMenuOpen]    = useState(false);
  const [reportOpen,      setReportOpen]      = useState(false);
  const [addToGroupOpen,  setAddToGroupOpen]  = useState(false);
  const [myGroups,        setMyGroups]        = useState([]);
  const [groupsLoading,   setGroupsLoading]   = useState(false);
  const [groupInvitingId, setGroupInvitingId] = useState(null);  // groupId being invited to
  const [groupInvitedIds, setGroupInvitedIds] = useState(new Set());
  const [avatarLightbox,  setAvatarLightbox]  = useState(false);
  const [myInterestIds,    setMyInterestIds]    = useState(new Set());
  const [myLifeStage,      setMyLifeStage]      = useState(null);
  const [myChurchId,       setMyChurchId]       = useState(null);
  const [myPoliticalLean,  setMyPoliticalLean]  = useState(null);
  const [myLoveLanguage,    setMyLoveLanguage]    = useState(null);
  const [myGoalIds,         setMyGoalIds]         = useState(new Set());
  const [myHometownCities,      setMyHometownCities]      = useState([]);
  const [myCurrentCity,         setMyCurrentCity]         = useState(null);
  const [myLookingForChurch,    setMyLookingForChurch]    = useState(null);
  const [theirPolitical,        setTheirPolitical]        = useState(null);
  const [theirLoveLanguage,     setTheirLoveLanguage]     = useState(null);
  const [theirGoalIds,          setTheirGoalIds]          = useState(new Set());
  const [theirHometownCities,   setTheirHometownCities]   = useState([]);
  const [theirLookingForChurch, setTheirLookingForChurch] = useState(null);

  // Score breakdown modal
  const [breakdownOpen,    setBreakdownOpen]    = useState(false);
  const [breakdown,        setBreakdown]        = useState(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError,   setBreakdownError]   = useState(false);
  // Category drill-down (interests / goals / values)
  const [activeCategory,   setActiveCategory]   = useState(null);   // key string or null
  const [categoryDetail,   setCategoryDetail]   = useState(null);   // full detail object
  const [detailFetching,   setDetailFetching]   = useState(false);

  // Full profile data — starts from whatever the caller passed, enriched by
  // get_profile_detail() when score / interests are missing.
  const [profile, setProfile] = useState({
    id:              initialMatch.id,
    name:            initialMatch.name,
    handle:          initialMatch.handle   ?? null,
    bio:             initialMatch.bio      ?? null,
    hometown:        initialMatch.hometown ?? null,
    initials:        initialMatch.initials,
    avatarUrl:       initialMatch.avatarUrl ?? null,
    avatarColor:     initialMatch.avatarColor,
    matchScore:      initialMatch.matchScore  ?? null,
    lifeStage:       initialMatch.lifeStage   ?? '',
    lifeStageId:     initialMatch.lifeStageId ?? null,
    distance:        initialMatch.distance    ?? '',
    church:          initialMatch.church      ?? null,
    churchId:        initialMatch.churchId    ?? null,
    cityState:       initialMatch.cityState  ?? null,
    interests:       initialMatch.interests  ?? [],
    connectionCount: null,
    groupCount:      null,
  });

  const needsFetch = initialMatch.matchScore === null || (initialMatch.interests ?? []).length === 0;
  const [detailLoading, setDetailLoading] = useState(needsFetch);

  const confirm    = useConfirm();
  const toast = useToast();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── Fetch full detail when caller didn't provide it ─────────────────────
  useEffect(() => {
    if (!initialMatch.id || !needsFetch) return;
    let cancelled = false;
    (async () => {
      const [{ data, error }, { data: theirLang }, { data: theirGoals }] = await Promise.all([
        supabase.rpc('get_profile_detail', { p_profile: initialMatch.id }),
        supabase.from('profiles').select('love_language_id, hometown_cities').eq('id', initialMatch.id).maybeSingle(),
        supabase.from('profile_goals').select('goal_id').eq('profile_id', initialMatch.id),
      ]);
      if (cancelled) return;
      if (error) {
        console.warn('[match] get_profile_detail failed', error.message);
        setDetailLoading(false);
        return;
      }
      const d = Array.isArray(data) ? data[0] : data;
      if (!d) { setDetailLoading(false); return; }

      setTheirPolitical(d.political_lean ?? null);
      setTheirLoveLanguage(theirLang?.love_language_id ?? null);
      setTheirGoalIds(new Set((theirGoals ?? []).map((r) => r.goal_id)));
      setTheirHometownCities((theirLang?.hometown_cities ?? []).map((c) => c.toLowerCase().trim()));
      setTheirLookingForChurch(d.looking_for_church ?? null);
      setProfile((prev) => ({
        ...prev,
        bio:             d.bio              ?? prev.bio,
        hometown:        d.hometown         ?? prev.hometown,
        lifeStage:       d.life_stage_label ?? prev.lifeStage,
        lifeStageId:     d.life_stage_id   ?? prev.lifeStageId,
        distance:        d.city && d.state ? `${d.city}, ${d.state}` : prev.distance,
        cityState:       d.city && d.state ? `${d.city}, ${d.state}` : prev.cityState,
        church:          d.church_name     ?? prev.church,
        churchId:        d.church_id       ?? prev.churchId,
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

  // ── Fetch my own profile data for In Common comparison ───────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: acts }, { data: me }, { data: goals }] = await Promise.all([
        supabase.from('profile_activities').select('activity_id').eq('profile_id', user.id),
        supabase.from('profiles').select('life_stage_id, church_id, political_lean, love_language_id, hometown_cities, city, state, looking_for_church').eq('id', user.id).maybeSingle(),
        supabase.from('profile_goals').select('goal_id').eq('profile_id', user.id),
      ]);
      if (cancelled) return;
      setMyInterestIds(new Set((acts ?? []).map((r) => r.activity_id)));
      setMyLifeStage(me?.life_stage_id ?? null);
      setMyChurchId(me?.church_id ?? null);
      setMyPoliticalLean(me?.political_lean ?? null);
      setMyLoveLanguage(me?.love_language_id ?? null);
      setMyGoalIds(new Set((goals ?? []).map((r) => r.goal_id)));
      setMyHometownCities((me?.hometown_cities ?? []).map((c) => c.toLowerCase().trim()));
      setMyCurrentCity(me?.city && me?.state ? `${me.city}, ${me.state}` : null);
      setMyLookingForChurch(me?.looking_for_church ?? null);
    })();
    return () => { cancelled = true; };
  }, [user]);

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

  // ── Score breakdown ──────────────────────────────────────────────────────
  async function handleScorePress() {
    if (!profile.id || profile.matchScore == null) return;
    setBreakdownError(false);
    setBreakdownOpen(true);
    if (breakdown) return; // already fetched
    setBreakdownLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_score_breakdown', {
        p_viewer:    user.id,
        p_candidate: profile.id,
      });
      if (!mountedRef.current) return;
      if (error || !data) {
        console.warn('[breakdown] rpc failed', error?.message);
        setBreakdownError(true);
      } else {
        setBreakdown(data);
      }
    } catch (e) {
      console.warn('[breakdown] fetch threw', e?.message);
      if (mountedRef.current) setBreakdownError(true);
    } finally {
      if (mountedRef.current) setBreakdownLoading(false);
    }
  }

  // ── Category detail (tap to expand) ──────────────────────────────────────
  const DETAIL_KEYS = new Set(['interests', 'goals', 'values']);

  async function handleCategoryPress(key) {
    if (!DETAIL_KEYS.has(key)) return;
    if (activeCategory === key) { setActiveCategory(null); return; } // toggle off
    setActiveCategory(key);
    if (categoryDetail) return; // already fetched
    setDetailFetching(true);
    try {
      const { data, error } = await supabase.rpc('get_score_breakdown_detail', {
        p_viewer:    user.id,
        p_candidate: profile.id,
      });
      if (!mountedRef.current) return;
      if (error || !data) {
        console.warn('[breakdown detail] rpc failed', error?.message);
      } else {
        setCategoryDetail(data);
      }
    } catch (e) {
      console.warn('[breakdown detail] fetch threw', e?.message);
    } finally {
      if (mountedRef.current) setDetailFetching(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (connected || !user || !profile.id) return;
    const willMatch = theirKind === 'like';
    setConnected(true);
    if (willMatch) setIsMatch(true); // optimistic: skip the Pending flash
    const { error } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: profile.id, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (!mountedRef.current) return;
    if (error) {
      setConnected(false);
      if (willMatch) setIsMatch(false);
      toast({ title: 'Could not connect', message: error.message, type: 'error' });
      return;
    }
    if (theirKind === 'like') {
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
      toast({ title: 'Could not undo', message: error.message, type: 'error' });
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
      toast({ title: 'Could not open chat', message: e?.message ?? 'Try again.', type: 'error' });
    } finally {
      if (mountedRef.current) setOpeningChat(false);
    }
  }

  async function handleBlock() {
    const ok = await confirm({
      title: 'Block user?',
      message: `${profile.name} won't be able to see your profile or message you.`,
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;

    try {
      await supabase.rpc('block_user', { p_target: profile.id });
      setMoreMenuOpen(false);
      navigation.goBack();
    } catch (e) {
      toast({ title: 'Could not block', message: e?.message ?? 'Try again.', type: 'error' });
    }
  }

  function handleReport() {
    setMoreMenuOpen(false);
    setReportOpen(true);
  }

  async function handleOpenAddToGroup() {
    setMoreMenuOpen(false);
    setAddToGroupOpen(true);
    setGroupsLoading(true);
    try {
      // Load all groups the current user is a member of
      const { data, error } = await supabase
        .from('group_members')
        .select('group_id, role, groups!inner(id, name, icon, icon_color, icon_bg)')
        .eq('profile_id', user.id);
      if (error) throw error;
      setMyGroups(
        (data ?? []).map((row) => ({ ...row.groups, role: row.role }))
      );
    } catch (e) {
      toast({ title: 'Could not load groups', message: e.message, type: 'error' });
    } finally {
      setGroupsLoading(false);
    }
  }

  async function handleInviteToGroup(groupId) {
    if (groupInvitingId === groupId || groupInvitedIds.has(groupId)) return;
    setGroupInvitingId(groupId);
    try {
      const { error } = await supabase.rpc('invite_to_group', {
        p_group:    groupId,
        p_invitees: [profile.id],
      });
      if (error) throw error;
      setGroupInvitedIds((prev) => new Set([...prev, groupId]));
      toast({ title: 'Invite sent!', message: `${profile.name?.split(' ')[0] || 'They'} will get a notification.`, type: 'success' });
    } catch (e) {
      toast({ title: 'Could not invite', message: e.message, type: 'error' });
    } finally {
      setGroupInvitingId(null);
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
        <TouchableOpacity
          onPress={() => setMoreMenuOpen(true)}
          style={styles.moreBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>

        {/* Hero */}
        <View style={styles.hero}>
          {/* Avatar + score ring in a contained relative wrapper */}
          <View style={styles.avatarContainer}>
            <TouchableOpacity
              activeOpacity={profile.avatarUrl ? 0.85 : 1}
              onPress={() => profile.avatarUrl && setAvatarLightbox(true)}
              disabled={!profile.avatarUrl}
            >
              <Avatar
                initials={profile.initials}
                size={96}
                gradientColors={profile.avatarColor ?? [COLORS.sage, COLORS.clay]}
                uri={profile.avatarUrl || undefined}
                style={styles.avatar}
              />
            </TouchableOpacity>

            <View style={styles.scoreWrap}>
              {detailLoading ? (
                <View style={styles.scoreLoadingWrap}>
                  <ActivityIndicator size="small" color={COLORS.textTertiary} />
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.scoreRingWrap}
                  activeOpacity={0.75}
                  onPress={handleScorePress}
                  disabled={profile.matchScore == null}
                >
                  <ScoreRing score={profile.matchScore} size={64} stroke={5} />
                  <Text style={styles.scoreLabel}>match ⓘ</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.heroName}>{profile.name}</Text>
          <Text style={styles.heroMeta}>
            {[profile.lifeStage, profile.distance].filter(Boolean).join(' · ')}
          </Text>

          {profile.cityState ? (
            <View style={styles.churchRow}>
              <Ionicons name="location-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.churchText}>{profile.cityState}</Text>
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

          {/* ── In Common — pinned to top ──────────────────────────── */}
          {(() => {
            const sharedInterests = profile.interests.filter((i) => myInterestIds.has(i.id));
            const sameStage     = !!(myLifeStage && profile.lifeStageId && myLifeStage === profile.lifeStageId);
            const sameChurch    = !!(myChurchId && profile.churchId && myChurchId === profile.churchId);
            const politicsAlign = myPoliticalLean != null && theirPolitical != null &&
              myPoliticalLean !== 0 && theirPolitical !== 0 &&
              ((myPoliticalLean > 0 && theirPolitical > 0) ||
               (myPoliticalLean < 0 && theirPolitical < 0));
            const politicsLabel = politicsAlign
              ? (myPoliticalLean > 0 ? 'Conservative' : 'Liberal')
              : null;
            const sameLoveLanguage = !!(myLoveLanguage && theirLoveLanguage &&
              myLoveLanguage !== 'not-sure' && theirLoveLanguage !== 'not-sure' &&
              myLoveLanguage === theirLoveLanguage);
            const loveLangLabel = sameLoveLanguage
              ? (LOVE_LANGUAGES.find((l) => l.id === myLoveLanguage)?.label ?? null)
              : null;
            const sharedGoals = COMMUNITY_GOALS.filter(
              (g) => myGoalIds.has(g.id) && theirGoalIds.has(g.id)
            );
            const normalizeCity = (raw) => {
              const s = (raw ?? '').toLowerCase().trim();
              return s.replace(/,?\s+[a-z]{2}$/, '').trim();
            };
            const myNorm    = myHometownCities.map(normalizeCity);
            const theirNorm = theirHometownCities.map(normalizeCity);
            const sharedCities = myHometownCities.filter((_, i) =>
              myNorm[i].length > 0 && theirNorm.includes(myNorm[i])
            );
            const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
            const sharedCityLabels = sharedCities.map(titleCase);

            // Same current city — where both live now
            const sameCurrentCity = !!(
              myCurrentCity &&
              profile.cityState &&
              normalizeCity(myCurrentCity) === normalizeCity(profile.cityState)
            );

            // Both church-goers (different churches — same church handled above as a banner)
            const bothChurchGoers = !sameChurch && !!(myChurchId && profile.churchId);
            // Both looking for a church home
            const bothLookingForChurch = myLookingForChurch === true && theirLookingForChurch === true;

            const hasCommon = sameStage || sameChurch || bothChurchGoers || bothLookingForChurch ||
              sharedInterests.length > 0 || politicsAlign || sameLoveLanguage ||
              sharedGoals.length > 0 || sharedCities.length > 0 || sameCurrentCity;

            return (
              <View style={styles.section}>
                <SectionHeader label="In Common" />
                <View style={styles.commonCard}>

                  {/* ── Banner: Same current city ─────────────────── */}
                  {sameCurrentCity ? (
                    <View style={[styles.commonBanner, styles.commonBannerSage]}>
                      <View style={[styles.commonBannerIcon, { backgroundColor: COLORS.sageBg }]}>
                        <Ionicons name="location" size={18} color={COLORS.sage} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commonBannerLabel}>You live in the same area</Text>
                        <Text style={styles.commonBannerSub}>{profile.cityState}</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* ── Banner: Shared hometown ───────────────────── */}
                  {sharedCityLabels.length > 0 ? (
                    <View style={[styles.commonBanner, styles.commonBannerClay]}>
                      <View style={[styles.commonBannerIcon, { backgroundColor: COLORS.clayBg }]}>
                        <Ionicons name="home" size={18} color={COLORS.clay} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commonBannerLabel}>
                          {sharedCityLabels.length === 1
                            ? `Both from ${sharedCityLabels[0]}`
                            : `${sharedCityLabels.length} shared hometowns`}
                        </Text>
                        {sharedCityLabels.length > 1 ? (
                          <Text style={styles.commonBannerSub}>
                            {sharedCityLabels.slice(0, 3).join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ) : null}

                  {/* ── Banner: Same church ───────────────────────── */}
                  {sameChurch ? (
                    <View style={[styles.commonBanner, styles.commonBannerGold]}>
                      <View style={[styles.commonBannerIcon, { backgroundColor: COLORS.goldBg }]}>
                        <Ionicons name="business-outline" size={18} color={COLORS.gold} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commonBannerLabel}>Same church</Text>
                        {profile.church ? (
                          <Text style={styles.commonBannerSub}>{profile.church}</Text>
                        ) : null}
                      </View>
                    </View>
                  ) : null}

                  {/* ── Row: Both church-goers (different churches) ── */}
                  {bothChurchGoers ? (
                    <View style={styles.commonRow}>
                      <View style={styles.commonRowIcon}>
                        <Ionicons name="business-outline" size={14} color={COLORS.gold} />
                      </View>
                      <Text style={styles.commonText}>Both attend church</Text>
                    </View>
                  ) : null}

                  {/* ── Row: Both looking for a church home ──────── */}
                  {bothLookingForChurch ? (
                    <View style={styles.commonRow}>
                      <View style={styles.commonRowIcon}>
                        <Ionicons name="search-outline" size={14} color={COLORS.gold} />
                      </View>
                      <Text style={styles.commonText}>Both looking for a church home</Text>
                    </View>
                  ) : null}

                  {/* ── Banner: Political alignment ───────────────── */}
                  {politicsAlign ? (
                    <View style={[styles.commonBanner, styles.commonBannerPolitics]}>
                      <View style={[styles.commonBannerIcon, { backgroundColor: '#EEF2FF' }]}>
                        <Ionicons name="shield-checkmark-outline" size={17} color="#4F6EB0" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.commonBannerLabel}>Politically aligned</Text>
                        <Text style={styles.commonBannerSub}>Both lean {politicsLabel}</Text>
                      </View>
                    </View>
                  ) : null}

                  {/* ── Row: Life stage ───────────────────────────── */}
                  {sameStage ? (
                    <View style={styles.commonRow}>
                      <View style={styles.commonRowIcon}>
                        <Ionicons name="people" size={14} color={COLORS.sage} />
                      </View>
                      <Text style={styles.commonText}>Same life stage</Text>
                    </View>
                  ) : null}

                  {/* ── Row: Love language ───────────────────────── */}
                  {sameLoveLanguage && loveLangLabel ? (
                    <View style={styles.commonRow}>
                      <View style={styles.commonRowIcon}>
                        <Ionicons name="heart" size={14} color={COLORS.clay} />
                      </View>
                      <Text style={styles.commonText}>
                        Same love language · <Text style={{ fontFamily: FONT.semiBold }}>{loveLangLabel}</Text>
                      </Text>
                    </View>
                  ) : null}

                  {/* ── Shared interests — labeled chip grid ─────── */}
                  {sharedInterests.length > 0 ? (
                    <View style={styles.commonInterestsBlock}>
                      <Text style={styles.commonInterestsLabel}>
                        {sharedInterests.length} {sharedInterests.length === 1 ? 'activity' : 'activities'} in common
                      </Text>
                      <View style={styles.commonChips}>
                        {sharedInterests.map((i) => (
                          <View key={i.id} style={styles.commonChip}>
                            <Text style={styles.commonChipText}>{i.label}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {/* ── Goals ─────────────────────────────────────── */}
                  {sharedGoals.map((g) => (
                    <View key={g.id} style={styles.commonRow}>
                      <View style={styles.commonRowIcon}>
                        <Ionicons name="flag" size={14} color={COLORS.sage} />
                      </View>
                      <Text style={styles.commonText}>Both looking for {g.label.toLowerCase()}</Text>
                    </View>
                  ))}

                  {/* ── Empty state ───────────────────────────────── */}
                  {!hasCommon && !detailLoading ? (
                    <View style={styles.commonRow}>
                      <Ionicons name="sparkles-outline" size={16} color={COLORS.textTertiary} />
                      <Text style={[styles.commonText, { color: COLORS.textSecondary }]}>
                        Connect to see what you have in common
                      </Text>
                    </View>
                  ) : null}
                  {detailLoading ? (
                    <ActivityIndicator size="small" color={COLORS.textTertiary} />
                  ) : null}
                </View>
              </View>
            );
          })()}

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

          {/* Where from */}
          {profile.hometown ? (
            <View style={styles.section}>
              <SectionHeader label="From" />
              <Text style={styles.bioText}>{profile.hometown}</Text>
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

        </View>
      </ScrollView>

      {/* ── Sticky bottom dock ───────────────────────────────────────────── */}
      <View style={styles.bottomDock}>
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
                   : isInbound ? 'Accept'
                   : 'Connect'}
                </Text>
              </TouchableOpacity>

              {/* Save — hidden once connected */}
              {ctaState !== 'connected' && (
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
              )}

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

      {/* ── Score breakdown sheet ─────────────────────────────────────────── */}
      <Modal
        visible={breakdownOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setBreakdownOpen(false); setActiveCategory(null); }}
      >
        <View style={styles.menuBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { setBreakdownOpen(false); setActiveCategory(null); }}
          />
          <View style={[styles.menuSheet, styles.breakdownSheet]}>
            {/* Handle bar */}
            <View style={styles.sheetHandle} />

            <View style={styles.breakdownHeader}>
              <ScoreRing score={profile.matchScore} size={56} stroke={4} />
              <View style={{ flex: 1 }}>
                <Text style={styles.breakdownTitle}>
                  {profile.matchScore != null ? `${profile.matchScore}% match` : 'Match score'}
                </Text>
                <Text style={styles.breakdownSub}>
                  Based on your profile overlap with {profile.name?.split(' ')[0] || 'them'}
                </Text>
              </View>
            </View>

            {breakdownLoading ? (
              <ActivityIndicator color={COLORS.textTertiary} style={{ marginVertical: 24 }} />
            ) : breakdownError ? (
              <Text style={[styles.breakdownNote, { marginVertical: 24 }]}>
                Couldn't load breakdown. Make sure you're connected and try again.
              </Text>
            ) : breakdown ? (() => {
              const rows = [
                { key: 'interests',  label: 'Interests',    icon: 'body-outline'         },
                { key: 'goals',      label: 'Goals',        icon: 'flag-outline'         },
                { key: 'life_stage', label: 'Life Stage',   icon: 'people-outline'       },
                { key: 'values',     label: 'Values',       icon: 'heart-outline'        },
                { key: 'hometown',   label: 'Hometown',     icon: 'home-outline'         },
                { key: 'political',  label: 'Politics',     icon: 'ribbon-outline'       },
              ];
              const isTappable = (key) => DETAIL_KEYS.has(key);
              return (
                <ScrollView
                  style={styles.breakdownRowsScroll}
                  contentContainerStyle={styles.breakdownRows}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {rows.map(({ key, label, icon }) => {
                    const d = breakdown[key];
                    if (!d) return null;
                    const pct = d.max > 0 ? d.pts / d.max : 0;
                    const subtitle = d.shared != null
                      ? `${d.shared} of ${d.total} shared`
                      : null;
                    const isOpen   = activeCategory === key;
                    const tappable = isTappable(key);
                    const detail   = categoryDetail?.[key];
                    const RowWrap  = tappable ? TouchableOpacity : View;
                    const rowProps = tappable
                      ? { onPress: () => handleCategoryPress(key), activeOpacity: 0.7 }
                      : {};
                    return (
                      <View key={key}>
                        <RowWrap {...rowProps} style={styles.breakdownRow}>
                          <View style={styles.breakdownRowLeft}>
                            <View style={styles.breakdownIconWrap}>
                              <Ionicons name={icon} size={14} color={COLORS.textSecondary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.breakdownRowLabel}>{label}</Text>
                              {subtitle ? (
                                <Text style={styles.breakdownRowSub}>{subtitle}</Text>
                              ) : null}
                            </View>
                          </View>
                          <View style={styles.breakdownBarWrap}>
                            <View style={styles.breakdownBarTrack}>
                              <View
                                style={[
                                  styles.breakdownBarFill,
                                  { width: `${Math.round(pct * 100)}%` },
                                  pct >= 0.7 ? styles.breakdownBarHigh
                                    : pct >= 0.3 ? styles.breakdownBarMid
                                    : styles.breakdownBarLow,
                                ]}
                              />
                            </View>
                            <Text style={styles.breakdownPts}>{d.pts}/{d.max}</Text>
                            {tappable ? (
                              <Ionicons
                                name={isOpen ? 'chevron-up' : 'chevron-down'}
                                size={12}
                                color={COLORS.textTertiary}
                                style={{ marginLeft: 4 }}
                              />
                            ) : null}
                          </View>
                        </RowWrap>

                        {/* ── Inline item expansion ── */}
                        {isOpen && tappable && (
                          <View style={styles.breakdownDetail}>
                            {detailFetching && !detail ? (
                              <ActivityIndicator size="small" color={COLORS.textTertiary} style={{ marginVertical: 8 }} />
                            ) : detail ? (
                              <>
                                {detail.shared?.length > 0 && (
                                  <>
                                    <Text style={styles.breakdownDetailHeading}>In common</Text>
                                    {detail.shared.map((item) => (
                                      <View key={item.id} style={styles.breakdownDetailRow}>
                                        <Ionicons name="checkmark-circle" size={14} color={COLORS.sage} style={{ marginRight: 6 }} />
                                        <Text style={styles.breakdownDetailLabel}>{item.label}</Text>
                                      </View>
                                    ))}
                                  </>
                                )}
                                {detail.candidate_only?.length > 0 && (
                                  <>
                                    <Text style={[styles.breakdownDetailHeading, { marginTop: detail.shared?.length > 0 ? 10 : 0 }]}>
                                      They have, you don't
                                    </Text>
                                    {detail.candidate_only.map((item) => (
                                      <View key={item.id} style={styles.breakdownDetailRow}>
                                        <Ionicons name="add-circle-outline" size={14} color={COLORS.textTertiary} style={{ marginRight: 6 }} />
                                        <Text style={[styles.breakdownDetailLabel, { color: COLORS.textTertiary }]}>{item.label}</Text>
                                      </View>
                                    ))}
                                  </>
                                )}
                                {detail.shared?.length === 0 && detail.candidate_only?.length === 0 && (
                                  <Text style={[styles.breakdownNote, { marginVertical: 8 }]}>Nothing in common here yet.</Text>
                                )}
                              </>
                            ) : null}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  <Text style={styles.breakdownNote}>
                    Tip: add more interests, goals, and values to your profile to improve your score.
                  </Text>
                </ScrollView>
              );
            })() : null}
          </View>
        </View>
      </Modal>

      {/* Action menu modal for block + report */}
      <Modal
        visible={moreMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreMenuOpen(false)}
      >
        <View style={styles.menuBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setMoreMenuOpen(false)}
          />
          <View style={styles.menuSheet}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleOpenAddToGroup}
              activeOpacity={0.7}
            >
              <Ionicons name="people-outline" size={18} color={COLORS.text} />
              <Text style={styles.menuItemText}>Add to Group</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleBlock}
              activeOpacity={0.7}
            >
              <Ionicons name="ban-outline" size={18} color="#C0392B" />
              <Text style={[styles.menuItemText, { color: '#C0392B' }]}>Block</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleReport}
              activeOpacity={0.7}
            >
              <Ionicons name="flag-outline" size={18} color={COLORS.textSecondary} />
              <Text style={styles.menuItemText}>Report</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Report sheet */}
      <ReportSheet
        visible={reportOpen}
        targetKind="profile"
        targetId={profile.id}
        onClose={() => setReportOpen(false)}
        onReported={() => {}}
      />

      {/* Add to group sheet */}
      <Modal
        visible={addToGroupOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setAddToGroupOpen(false); setGroupInvitedIds(new Set()); }}
      >
        <View style={styles.menuBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { setAddToGroupOpen(false); setGroupInvitedIds(new Set()); }}
          />
          <View style={[styles.menuSheet, { paddingBottom: 24, maxHeight: '70%' }]}>
            <View style={addToGroupStyles.handle} />
            <View style={addToGroupStyles.headerRow}>
              <Text style={addToGroupStyles.title}>Add to Group</Text>
              <TouchableOpacity
                onPress={() => { setAddToGroupOpen(false); setGroupInvitedIds(new Set()); }}
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {groupsLoading ? (
              <View style={{ paddingVertical: 28, alignItems: 'center' }}>
                <ActivityIndicator color={COLORS.textTertiary} />
              </View>
            ) : myGroups.length === 0 ? (
              <View style={{ paddingVertical: 28, alignItems: 'center', gap: 8 }}>
                <Ionicons name="people-outline" size={26} color={COLORS.textTertiary} />
                <Text style={{ fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' }}>
                  You haven't joined any groups yet.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {myGroups.map((group) => {
                  const isSending = groupInvitingId === group.id;
                  const isSent    = groupInvitedIds.has(group.id);
                  return (
                    <View key={group.id} style={addToGroupStyles.groupRow}>
                      <View style={[addToGroupStyles.groupIcon, { backgroundColor: group.icon_bg ?? COLORS.sageBg }]}>
                        <Ionicons name={group.icon ?? 'people'} size={18} color={group.icon_color ?? COLORS.sage} />
                      </View>
                      <Text style={addToGroupStyles.groupName} numberOfLines={1}>{group.name}</Text>
                      <TouchableOpacity
                        style={[addToGroupStyles.inviteBtn, isSent && addToGroupStyles.inviteBtnDone]}
                        onPress={() => handleInviteToGroup(group.id)}
                        disabled={isSending || isSent}
                        activeOpacity={0.8}
                      >
                        {isSending ? (
                          <ActivityIndicator size="small" color={COLORS.white} />
                        ) : (
                          <Text style={[addToGroupStyles.inviteBtnText, isSent && addToGroupStyles.inviteBtnTextDone]}>
                            {isSent ? 'Invited ✓' : 'Invite'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Avatar lightbox — tap profile photo to expand */}
      <Modal
        visible={avatarLightbox}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarLightbox(false)}
      >
        <View style={styles.lightboxRoot}>
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => setAvatarLightbox(false)}
          />
          {profile.avatarUrl ? (
            <Image
              source={{ uri: profile.avatarUrl }}
              style={{
                width:  Dimensions.get('window').width  * 0.88,
                height: Dimensions.get('window').height * 0.7,
                borderRadius: 16,
              }}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            style={styles.lightboxClose}
            activeOpacity={0.8}
            onPress={() => setAvatarLightbox(false)}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  moreBtn: {
    width: 40, height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },

  // Hero
  hero: {
    alignItems: 'center',
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    position: 'relative',
  },
  avatar: { ...SHADOW.md },
  avatarContainer: {
    position: 'relative',
    width: 96,
    height: 96,
    marginBottom: SPACING.lg,
  },
  scoreWrap: {
    position: 'absolute',
    bottom: -26,
    right: -42,
  },
  scoreRingWrap: {
    alignItems: 'center',
    gap: 2,
  },
  scoreLabel: {
    fontFamily: FONT.mono,
    fontSize: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
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
  commonText: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.text, flex: 1 },

  // Icon pill used in row items
  commonRowIcon: {
    width: 26, height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Shared interests labeled block
  commonInterestsBlock: {
    gap: 8,
  },
  commonInterestsLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  commonChips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  commonChip: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  commonChipText: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.text,
  },

  // Banner items — high-signal location/church matches
  commonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    padding: SPACING.md,
  },
  commonBannerSage: {
    backgroundColor: COLORS.sageBg,
    borderColor: COLORS.sageLight,
  },
  commonBannerClay: {
    backgroundColor: '#FDF0E8',
    borderColor: COLORS.clay,
  },
  commonBannerGold: {
    backgroundColor: COLORS.goldBg,
    borderColor: COLORS.gold,
  },
  commonBannerPolitics: {
    backgroundColor: '#EEF2FF',
    borderColor: '#B0BEE0',
  },
  commonBannerIcon: {
    width: 36, height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commonBannerLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  commonBannerSub: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

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

  // Avatar lightbox
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Score breakdown sheet
  breakdownSheet: {
    paddingTop: SPACING.sm,
    maxHeight: '88%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.sm,
  },
  breakdownTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 20,
    color: COLORS.text,
  },
  breakdownSub: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  breakdownRowsScroll: {
    flex: 1,
  },
  breakdownRows: {
    gap: 10,
    paddingBottom: SPACING.xl,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  breakdownRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 120,
  },
  breakdownIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownRowLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
  },
  breakdownRowSub: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  breakdownBarWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.surfaceAlt,
    overflow: 'hidden',
  },
  breakdownBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  breakdownBarHigh: { backgroundColor: COLORS.sage },
  breakdownBarMid:  { backgroundColor: COLORS.gold },
  breakdownBarLow:  { backgroundColor: COLORS.border },
  breakdownPts: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: COLORS.textTertiary,
    width: 30,
    textAlign: 'right',
  },
  breakdownNote: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
    textAlign: 'center',
    lineHeight: 17,
  },

  breakdownDetail: {
    backgroundColor: COLORS.surface ?? '#F4F1EC',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.xs,
    marginTop: 4,
  },
  breakdownDetailHeading: {
    fontFamily: FONT.medium,
    fontSize: 11,
    color: COLORS.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  breakdownDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  breakdownDetailLabel: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
  },

  // Action menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    // On web the Modal portals to the document root, outside the phone-width
    // frame in App.js — cap + center so the sheet stays inside the phone
    // column instead of stretching the whole browser. No-op on native.
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 430 : undefined,
    alignSelf: 'center',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    ...SHADOW.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuItemText: {
    flex: 1,
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
  },
});

const addToGroupStyles = StyleSheet.create({
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
    paddingHorizontal: 4,
  },
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 20,
    color: COLORS.text,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupName: {
    flex: 1,
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  inviteBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    height: 34,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteBtnDone: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inviteBtnText: {
    fontFamily: FONT.bold,
    fontSize: 13,
    color: COLORS.white,
  },
  inviteBtnTextDone: {
    color: COLORS.sage,
  },
});
