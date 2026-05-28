import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../theme';
import PersonCard from '../components/PersonCard';
import InboundStrip from '../components/InboundStrip';
import LocationFilterSheet from '../components/LocationFilterSheet';
import { Wordmark, Chip, Pill, IconButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useUnreadNotifications } from '../lib/notifications';
import {
  loadFilter,
  saveFilter,
  filterToRpcArgs,
  filterLabel,
  DEFAULT_FILTER,
} from '../lib/locationFilter';

// Filter chips (non-location). Location lives in the dedicated pill above.
// "All" + every discovery filter (saved/stage/church/new) hides existing
// connections so Discover stays a feed of *new* people to meet. "Connections"
// is the inverse — only people you're mutually matched with.
const FILTERS = [
  { id: 'all',         label: 'All'           },
  { id: 'connections', label: 'Connections'   },
  { id: 'pending',     label: 'Pending'       },
  { id: 'saved',       label: 'Connect Later' },
  { id: 'stage',       label: 'Life Stage'    },
  { id: 'interests',   label: 'Interests'     },
  { id: 'new',         label: 'New'           },
];

// Height of the FOUND + bell header block
const HEADER_HEIGHT = 88;

// ─── Helpers ──────────────────────────────────────────────────────────────
// Fixed gradient palette for avatars (matches existing visual language)
// Neutral monochrome avatar palette — black/white/charcoal, no green or yellow.
// Matches Sam's branding direction (less green tint, more black & white).
const AVATAR_GRADIENTS = [
  ['#1A1A1A', '#3A3A3A'],
  ['#2A2A2A', '#4A4A4A'],
  ['#3A3A3A', '#5A5A5A'],
  ['#1A1A1A', '#2A2A2A'],
  ['#4A4A4A', '#1A1A1A'],
  ['#2A2A2A', '#1A1A1A'],
  ['#3A3A3A', '#1A1A1A'],
  ['#5A5A5A', '#2A2A2A'],
];

// Deterministic hash → palette index, so each profile always picks the same colors
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

function formatDistance(mi) {
  if (mi == null) return null;
  const n = Number(mi);
  if (!isFinite(n)) return null;
  if (n < 0.1) return '0.1 mi';
  if (n < 10)  return `${n.toFixed(1)} mi`;
  return `${Math.round(n)} mi`;
}

// RPC row → PersonCard shape
function rowToMatch(row) {
  return {
    id:          row.profile_id,
    name:        row.full_name || row.handle || 'Someone',
    handle:      row.handle || null,
    bio:         row.bio || null,
    city:        row.city || null,
    state:       row.state || null,
    initials:    initialsFor(row.full_name || row.handle),
    avatarUrl:   row.avatar_url || null,
    avatarColor: gradientFor(row.profile_id),
    matchScore:  row.score ?? 0,
    lifeStage:   row.life_stage_label || '',
    lifeStageId: row.life_stage_id || null,
    distance:    formatDistance(row.distance_mi) || [row.city, row.state].filter(Boolean).join(', ') || '',
    cityState:   [row.city, row.state].filter(Boolean).join(', ') || null,
    church:      row.church_name,
    churchId:    row.church_id || null,
    createdAt:   row.created_at || null,
    interests:   (row.activities ?? []).map((a) => ({
      id:        a.id,
      label:     a.label,
      icon:      a.icon,
      iconColor: a.icon_color,
    })),
    connected:    row.my_kind    === 'like',
    saved:        false, // overwritten from saved_profiles after the feed loads
    theirKind:    row.their_kind || null,
    isMatch:      !!row.is_match,
    sameHometown: !!row.same_hometown,
    mutualCount:  row.mutual_count ?? 0,
  };
}

// "New" filter window — surface profiles created within the last N days.
const NEW_WINDOW_DAYS = 30;

// How long after Discover mounts before nudging the user to add a bio.
const BIO_PROMPT_DELAY_MS = 120000; // 2 minutes

// True when the profile has no usable bio (null, empty, or whitespace).
function bioIsEmpty(p) {
  return !p || !p.bio || p.bio.trim().length === 0;
}

export default function HomeScreen({ navigation }) {
  const { user, profile } = useAuth();
  const { count: notifCount } = useUnreadNotifications(user?.id, 'home');

  const [activeFilter, setActiveFilter] = useState('all');
  const [query, setQuery]               = useState('');
  const [matches, setMatches]           = useState([]);
  const [inbound, setInbound]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState(null);

  // Location filter (loaded from AsyncStorage on mount).
  // `selfLocation` is my own profile's lat/lng — needed so "Near Me" mode can
  // pass an explicit point to the RPC override (the RPC defaults to my profile
  // location for distance display, but the hard radius filter only kicks in
  // when override lat/lng are provided).
  const [locFilter, setLocFilter]   = useState(DEFAULT_FILTER);
  const [selfLocation, setSelfLoc]  = useState(null);
  const [locSheetOpen, setLocSheet] = useState(false);

  // My own activity IDs — used by the "Interests" filter to surface profiles
  // who share at least one interest with me.
  const [myActivityIds, setMyActivityIds] = useState([]);

  // Incomplete-profile nudge: a dismissable modal that fires once, two minutes
  // into the session, if the user still hasn't written a bio.
  const [bioPromptOpen, setBioPromptOpen] = useState(false);
  const profileRef        = useRef(profile);  // latest profile for the timeout closure
  const bioPromptShownRef = useRef(false);    // once-per-session guard

  const headerTranslate = useRef(new Animated.Value(0)).current;
  const lastScrollY     = useRef(0);
  const headerVisible   = useRef(true);

  const loadMatches = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // Translate the active location filter into RPC override args.
      const overrideArgs = filterToRpcArgs(locFilter, selfLocation);

      // Matches feed + inbound + my Connect Later list, in parallel.
      const [matchesRes, inboundRes, savedRes] = await Promise.all([
        supabase.rpc('top_matches_detailed', { p_limit: 100, ...overrideArgs }),
        supabase.rpc('inbound_connections'),
        supabase.from('saved_profiles').select('saved_id'),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (inboundRes.error) console.warn('[discover] inbound failed', inboundRes.error.message);
      if (savedRes.error)   console.warn('[discover] saved list failed', savedRes.error.message);

      // Flag which feed rows are already in the private Connect Later list.
      const savedSet = new Set((savedRes.data ?? []).map((r) => r.saved_id));
      setMatches((matchesRes.data ?? []).map((row) => {
        const m = rowToMatch(row);
        m.saved = savedSet.has(m.id);
        return m;
      }));
      setInbound(inboundRes.data ?? []);
    } catch (e) {
      console.warn('[discover] load failed', e?.message);
      setError(e?.message ?? 'Could not load matches.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, locFilter, selfLocation]);

  // Bootstrap: hydrate saved location filter + my own coords.
  useEffect(() => {
    (async () => {
      const f = await loadFilter();
      setLocFilter(f);
    })();
  }, []);

  // Pull my own lat/lng so "Near Me" can pass it as an explicit override.
  // get_my_location() returns 0 rows when the user hasn't geocoded a location;
  // selfLocation stays null in that case and the "Near Me" sheet option is
  // disabled.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_my_location');
      if (cancelled) return;
      if (rpcErr) {
        console.warn('[discover] get_my_location failed', rpcErr.message);
        return;
      }
      const row = Array.isArray(data) ? data[0] : null;
      if (row?.lat != null && row?.lng != null) {
        setSelfLoc({ lat: Number(row.lat), lng: Number(row.lng) });
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Load my own activity IDs once for the Interests filter. Cheap, single
  // round-trip; only refetched if the user changes (sign-out / sign-in).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error: actErr } = await supabase
        .from('profile_activities')
        .select('activity_id')
        .eq('profile_id', user.id);
      if (cancelled) return;
      if (actErr) {
        console.warn('[discover] my activities failed', actErr.message);
        return;
      }
      setMyActivityIds((data ?? []).map((r) => r.activity_id).filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Refetch on focus so returning from Activity/MatchDetail picks up state
  // changes (newly accepted matches, dismissed inbound rows, etc.) without
  // requiring a manual pull-to-refresh.
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => loadMatches({ isRefresh: true }));
    return unsub;
  }, [navigation, loadMatches]);

  // Keep a ref to the freshest profile so the bio-nudge timeout (set once on
  // mount) reads current state instead of a stale closure value.
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Two minutes in, nudge the user to add a bio — once per session, and only
  // if they still don't have one. Dismissable; not a hard requirement.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (bioPromptShownRef.current) return;
      if (bioIsEmpty(profileRef.current)) {
        bioPromptShownRef.current = true;
        setBioPromptOpen(true);
      }
    }, BIO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Mutate one match row in place — used by all three handlers below to
  // keep the visible card in sync with the server without a full refetch.
  const patchMatch = useCallback((id, patch) => {
    setMatches((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Optimistic Connect. RLS allows insert where from_profile = auth.uid().
  // PK (from, to, kind) → re-tap is a no-op via ignoreDuplicates.
  // If theirKind === 'like' this is a reciprocal → flip isMatch immediately
  // so the card jumps from "Accept" straight to "Connected" instead of
  // bouncing through "Pending" before the next refresh.
  const handleConnect = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    let wasReciprocal = false;
    setMatches((prev) => prev.map((m) => {
      if (m.id !== toProfileId) return m;
      wasReciprocal = m.theirKind === 'like';
      return { ...m, connected: true, isMatch: wasReciprocal ? true : m.isMatch };
    }));
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: toProfileId, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (insErr) {
      patchMatch(toProfileId, wasReciprocal
        ? { connected: false, isMatch: false }
        : { connected: false });
      console.warn('[discover] connect failed', insErr.message);
    }
  }, [user, patchMatch]);

  // Connect Later — toggle this person in the user's private saved list.
  // Optimistic; saved_profiles RLS scopes every row to saver_id = auth.uid().
  // `currentlySaved` is passed in by the card so we don't close over `matches`.
  const handleSave = useCallback(async (toProfileId, currentlySaved) => {
    if (!user || !toProfileId) return;
    patchMatch(toProfileId, { saved: !currentlySaved });
    const { error } = currentlySaved
      ? await supabase
          .from('saved_profiles')
          .delete()
          .eq('saver_id', user.id)
          .eq('saved_id', toProfileId)
      : await supabase
          .from('saved_profiles')
          .upsert(
            { saver_id: user.id, saved_id: toProfileId },
            { onConflict: 'saver_id,saved_id', ignoreDuplicates: true }
          );
    if (error) {
      patchMatch(toProfileId, { saved: !!currentlySaved }); // revert
      console.warn('[discover] save toggle failed', error.message);
    }
  }, [user, patchMatch]);

  // Undo a connect (pending OR mutual). PersonCard only ever cancels 'like'.
  const handleCancel = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    patchMatch(toProfileId, { connected: false, isMatch: false });
    const { error: rpcErr } = await supabase.rpc('remove_connection', {
      p_other: toProfileId,
      p_kind:  'like',
    });
    if (rpcErr) {
      patchMatch(toProfileId, { connected: true }); // revert
      console.warn('[discover] remove failed', rpcErr.message);
    }
  }, [user, patchMatch]);

  const handleScroll = ({ nativeEvent }) => {
    const y    = nativeEvent.contentOffset.y;
    const diff = y - lastScrollY.current;

    if (diff > 6 && headerVisible.current) {
      headerVisible.current = false;
      Animated.timing(headerTranslate, {
        toValue: -HEADER_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (diff < -6 && !headerVisible.current) {
      headerVisible.current = true;
      Animated.timing(headerTranslate, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }

    lastScrollY.current = y;
  };

  // Persist + apply a new location filter, then refetch.
  async function handleApplyLocation(nextFilter) {
    setLocSheet(false);
    setLocFilter(nextFilter);
    await saveFilter(nextFilter);
    // loadMatches re-runs automatically because it depends on locFilter
  }

  // The strip is an action prompt — "people you haven't dealt with yet."
  // Once you've accepted (became a match) OR sent them a connect request,
  // the row should drop off here. They still live in the matches list below
  // (with the appropriate Connected / Pending state).
  const pendingInbound = inbound.filter(
    (r) => !r.is_match && !r.my_kind
  );

  // Convert an inbound row → match shape so MatchDetail renders correctly.
  function inboundToMatch(row) {
    return {
      id:          row.profile_id,
      name:        row.full_name || row.handle || 'Someone',
      handle:      row.handle || null,
      bio:         row.bio || null,
      initials:    initialsFor(row.full_name || row.handle),
      avatarUrl:   row.avatar_url || null,
      avatarColor: gradientFor(row.profile_id),
      matchScore:  null,
      lifeStage:   row.life_stage_label || '',
      distance:    [row.city, row.state].filter(Boolean).join(', ') || '',
      cityState:   [row.city, row.state].filter(Boolean).join(', ') || null,
      church:      null,
      interests:   [],
      connected:   row.my_kind   === 'like',
      theirKind:   row.their_kind || null,
      isMatch:     !!row.is_match,
    };
  }

  // Client-side view of the already-loaded match feed: apply the active filter
  // chip first, then the text search. Cheap (feed is capped at 100 rows) and
  // instant — no extra round-trip. Promote to a server RPC if the feed ever
  // grows past a few hundred rows.
  //   all         → everyone I'm NOT already connected with
  //   connections → only mutual matches (people I'm connected with)
  //   saved       → only people in my private Connect Later list
  //   stage       → same life stage as me   (compares life_stage_id, not the label)
  //   church      → same church as me       (compares church_id)
  //   new         → joined in the last NEW_WINDOW_DAYS days
  // Discovery filters all hide existing connections; the Connections tab is the
  // one place they appear.
  const visibleMatches = useMemo(() => {
    let list = matches;

    if (activeFilter === 'connections') {
      list = list.filter((m) => m.isMatch);
    } else if (activeFilter === 'pending') {
      // Sent a request but not yet mutual.
      list = list.filter((m) => m.connected && !m.isMatch);
    } else {
      // Discovery views — hide matches AND people I've already sent a request to.
      list = list.filter((m) => !m.isMatch && !m.connected);

      if (activeFilter === 'saved') {
        list = list.filter((m) => m.saved);
      } else if (activeFilter === 'stage' && profile?.life_stage_id) {
        list = list.filter((m) => m.lifeStageId === profile.life_stage_id);
      } else if (activeFilter === 'church' && profile?.church_id) {
        list = list.filter((m) => m.churchId === profile.church_id);
      } else if (activeFilter === 'interests' && myActivityIds.length > 0) {
        const mine = new Set(myActivityIds);
        list = list.filter((m) => (m.interests ?? []).some((i) => mine.has(i.id)));
      } else if (activeFilter === 'new') {
        const cutoff = Date.now() - NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        list = list.filter((m) => {
          const t = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
          return Number.isFinite(t) && t >= cutoff;
        });
      }
    }

    const q = query.trim().toLowerCase();
    if (q) {
      // Search across every text field on a profile, not just the name.
      // Builds one lowercased haystack per row (name, handle, bio, church,
      // life stage, city/state, distance label, and every interest label).
      list = list.filter((m) => {
        const haystack = [
          m.name,
          m.handle,
          m.bio,
          m.church,
          m.lifeStage,
          m.city,
          m.state,
          m.distance,
          ...(m.interests ?? []).map((i) => i.label),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return list;
  }, [matches, query, activeFilter, profile, myActivityIds]);

  const searching   = query.trim().length > 0;
  const filtering   = activeFilter !== 'all';
  const narrowed    = searching || filtering;

  // Title row + location pill + search + inbound strip + filter chips.
  // NOTE: this is a JSX *element*, not a component function. Passing an element
  // to FlatList's ListHeaderComponent keeps the search TextInput mounted across
  // re-renders (a new function identity on every keystroke would remount it and
  // drop keyboard focus).
  const listHeader = (
    <View style={styles.listHeader}>
      {/* Location filter pill — tap to open the bottom sheet */}
      <View style={styles.locationPillRow}>
        <TouchableOpacity
          style={styles.locationPill}
          activeOpacity={0.8}
          onPress={() => setLocSheet(true)}
        >
          <Ionicons name="location-outline" size={14} color={COLORS.text} />
          <Text style={styles.locationPillText}>{filterLabel(locFilter)}</Text>
          <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search people, churches, interests…"
            placeholderTextColor={COLORS.textTertiary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searching ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={COLORS.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <InboundStrip
        rows={pendingInbound}
        onTap={(row) => navigation?.navigate('MatchDetail', { match: inboundToMatch(row) })}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            active={activeFilter === f.id}
            onPress={() => setActiveFilter(f.id)}
          />
        ))}
      </ScrollView>

    </View>
  );

  const EmptyState = () => {
    if (loading) {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={COLORS.textTertiary} />
          <Text style={styles.stateBody}>Finding your community…</Text>
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.stateBox}>
          <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.stateTitle}>Couldn't load people</Text>
          <Text style={styles.stateBody}>{error}</Text>
          <Text style={styles.stateHint}>Pull down to retry.</Text>
        </View>
      );
    }
    // Feed has people, but the current search/filter matched none of them.
    if (narrowed && matches.length > 0) {
      const filterLabelText =
        FILTERS.find((f) => f.id === activeFilter)?.label || 'this filter';
      const body = searching
        ? `No one matches “${query.trim()}”${filtering ? ` in “${filterLabelText}”` : ''}. Try a different search.`
        : `No one fits “${filterLabelText}” yet. Tap “All” to see everyone.`;
      return (
        <View style={styles.stateBox}>
          <Ionicons name="search-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.stateTitle}>No matches</Text>
          <Text style={styles.stateBody}>{body}</Text>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
        <Text style={styles.stateTitle}>More Christians joining every day</Text>
        <Text style={styles.stateBody}>
          Check back soon — we'll surface the best fits for you as more people in your area join FOUND.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* ── Sticky header — absolutely positioned so it floats above the list ── */}
      <Animated.View style={[styles.header, { transform: [{ translateY: headerTranslate }] }]}>
        <View>
          <Text style={styles.headerMeta}>30A Area · Friday</Text>
          <Wordmark size="md" />
        </View>
        <View style={styles.bellWrap}>
          <IconButton onPress={() => navigation?.navigate('NotificationsFeed')}>
            <Ionicons name="notifications-outline" size={18} color={COLORS.text} />
          </IconButton>
          {notifCount > 0 ? (
            <View style={styles.bellBadge} pointerEvents="none">
              <Text style={styles.bellBadgeText}>
                {notifCount > 9 ? '9+' : String(notifCount)}
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* ── Match cards — paddingTop reserves room under the fixed header ── */}
      <FlatList
        data={visibleMatches}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={EmptyState}
        renderItem={({ item }) => (
          <PersonCard
            match={item}
            onConnect={() => handleConnect(item.id)}
            onSave={() => handleSave(item.id, item.saved)}
            onCancel={() => handleCancel(item.id)}
            onPress={() => navigation?.navigate('MatchDetail', { match: item })}
          />
        )}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadMatches({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      />

      <LocationFilterSheet
        visible={locSheetOpen}
        onClose={() => setLocSheet(false)}
        onApply={handleApplyLocation}
        initialFilter={locFilter}
        selfHasLocation={!!selfLocation}
      />

      {/* Incomplete-profile nudge — dismissable, fires once per session */}
      <Modal
        visible={bioPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBioPromptOpen(false)}
      >
        <View style={styles.bioModalOverlay}>
          <View style={styles.bioModalCard}>
            <View style={styles.bioModalIcon}>
              <Ionicons name="person-circle-outline" size={32} color={COLORS.text} />
            </View>
            <Text style={styles.bioModalTitle}>Account not complete</Text>
            <Text style={styles.bioModalBody}>
              Add a bio to help find closer connections.
            </Text>
            <TouchableOpacity
              style={styles.bioModalPrimary}
              activeOpacity={0.85}
              onPress={() => {
                setBioPromptOpen(false);
                navigation?.navigate('EditProfile');
              }}
            >
              <Text style={styles.bioModalPrimaryText}>Add bio</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bioModalSecondary}
              activeOpacity={0.7}
              onPress={() => setBioPromptOpen(false)}
            >
              <Text style={styles.bioModalSecondaryText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // Bell + unread badge in the header
  bellWrap: { position: 'relative' },
  bellBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#D24A4A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.bg,
  },
  bellBadgeText: {
    fontFamily: FONT.bold,
    fontSize: 9,
    color: COLORS.white,
  },

  // Absolutely positioned so it overlays the list and can animate out
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.bg,
  },
  headerMeta: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 3,
  },

  // The FlatList's ListHeaderComponent
  listHeader: {
    paddingTop: SPACING.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  pageTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },


  // Location pill — top of header, opens the LocationFilterSheet
  locationPillRow: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  locationPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  locationPillText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
  },

  // Search bar
  searchRow: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 9 : 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
    // Kill the default focus ring on web — the box already has a border.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  list: {
    paddingTop: HEADER_HEIGHT,   // content starts below the fixed header
    paddingHorizontal: SPACING.lg,
    paddingBottom: 110,
  },

  // Empty / loading / error states
  stateBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  stateTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 18,
    color: COLORS.text,
  },
  stateBody: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  stateHint: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
  },

  // Incomplete-profile nudge modal.
  // alignItems:'center' + maxWidth keeps the card phone-width on web, where a
  // transparent Modal portals to the full-window document root.
  bioModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  bioModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.text,
  },
  bioModalIcon: {
    marginBottom: SPACING.sm,
  },
  bioModalTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 22,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  bioModalBody: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  bioModalPrimary: {
    width: '100%',
    backgroundColor: COLORS.text,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  bioModalPrimaryText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  bioModalSecondary: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  bioModalSecondaryText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
});
