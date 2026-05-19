import React, { useState, useRef, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../theme';
import PersonCard from '../components/PersonCard';
import InboundStrip from '../components/InboundStrip';
import LocationFilterSheet from '../components/LocationFilterSheet';
import { Wordmark, Chip, Pill, IconButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import {
  loadFilter,
  saveFilter,
  filterToRpcArgs,
  filterLabel,
  DEFAULT_FILTER,
} from '../lib/locationFilter';

// Filter chips (non-location). Location lives in the dedicated pill above.
const FILTERS = [
  { id: 'all',    label: 'All'         },
  { id: 'stage',  label: 'Life Stage'  },
  { id: 'church', label: 'Same Church' },
  { id: 'new',    label: 'New'         },
];

// Height of the FOUND + bell header block
const HEADER_HEIGHT = 72;

// ─── Helpers ──────────────────────────────────────────────────────────────
// Fixed gradient palette for avatars (matches existing visual language)
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
    initials:    initialsFor(row.full_name || row.handle),
    avatarUrl:   row.avatar_url || null,
    avatarColor: gradientFor(row.profile_id),
    matchScore:  row.score ?? 0,
    lifeStage:   row.life_stage_label || '',
    distance:    formatDistance(row.distance_mi) || [row.city, row.state].filter(Boolean).join(', ') || '',
    church:      row.church_name,
    interests:   (row.activities ?? []).map((a) => ({
      id:        a.id,
      label:     a.label,
      icon:      a.icon,
      iconColor: a.icon_color,
    })),
    connected:   row.my_kind    === 'like',
    waved:       row.my_kind    === 'wave',
    theirKind:   row.their_kind || null,
    isMatch:     !!row.is_match,
  };
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();

  const [activeFilter, setActiveFilter] = useState('all');
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

  const headerTranslate = useRef(new Animated.Value(0)).current;
  const lastScrollY     = useRef(0);
  const headerVisible   = useRef(true);

  const loadMatches = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // Translate the active location filter into RPC override args.
      const overrideArgs = filterToRpcArgs(locFilter, selfLocation);

      // Matches feed + inbound in parallel.
      const [matchesRes, inboundRes] = await Promise.all([
        supabase.rpc('top_matches_detailed', { p_limit: 100, ...overrideArgs }),
        supabase.rpc('inbound_connections'),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (inboundRes.error) console.warn('[discover] inbound failed', inboundRes.error.message);

      setMatches((matchesRes.data ?? []).map(rowToMatch));
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

  // Refetch on focus so returning from Activity/MatchDetail picks up state
  // changes (newly accepted matches, dismissed inbound rows, etc.) without
  // requiring a manual pull-to-refresh.
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => loadMatches({ isRefresh: true }));
    return unsub;
  }, [navigation, loadMatches]);

  // Mutate one match row in place — used by all three handlers below to
  // keep the visible card in sync with the server without a full refetch.
  const patchMatch = useCallback((id, patch) => {
    setMatches((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Optimistic Connect. RLS allows insert where from_profile = auth.uid().
  // PK (from, to, kind) → re-tap is a no-op via ignoreDuplicates.
  const handleConnect = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    patchMatch(toProfileId, { connected: true, waved: false });
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: toProfileId, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (insErr) {
      patchMatch(toProfileId, { connected: false });
      console.warn('[discover] connect failed', insErr.message);
    }
  }, [user, patchMatch]);

  // Wave = softer "hi" signal. Same upsert pattern with kind='wave'.
  const handleWave = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    patchMatch(toProfileId, { waved: true });
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: toProfileId, kind: 'wave' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (insErr) {
      patchMatch(toProfileId, { waved: false });
      console.warn('[discover] wave failed', insErr.message);
    }
  }, [user, patchMatch]);

  // Undo a connect (pending OR mutual) or a wave.
  // kind === 'like' cancels the connect; kind === 'wave' cancels the wave.
  const handleCancel = useCallback(async (toProfileId, kind) => {
    if (!user || !toProfileId || !kind) return;
    // Optimistic patch
    const patch = kind === 'like'
      ? { connected: false, isMatch: false }
      : { waved: false };
    patchMatch(toProfileId, patch);
    const { error: rpcErr } = await supabase.rpc('remove_connection', {
      p_other: toProfileId,
      p_kind:  kind,
    });
    if (rpcErr) {
      // Revert
      const revert = kind === 'like'
        ? { connected: true }
        : { waved: true };
      patchMatch(toProfileId, revert);
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
  // Once you've accepted (became a match) OR sent them anything ('like' / 'wave'),
  // the row should drop off here. They still live in the matches list below
  // (with the appropriate Connected / Pending / Waved state).
  const pendingInbound = inbound.filter(
    (r) => !r.is_match && !r.my_kind
  );

  // Convert an inbound row → match shape so MatchDetail renders correctly.
  function inboundToMatch(row) {
    return {
      id:          row.profile_id,
      name:        row.full_name || row.handle || 'Someone',
      initials:    initialsFor(row.full_name || row.handle),
      avatarUrl:   row.avatar_url || null,
      avatarColor: gradientFor(row.profile_id),
      matchScore:  null,
      lifeStage:   row.life_stage_label || '',
      distance:    [row.city, row.state].filter(Boolean).join(', ') || '',
      church:      null,
      interests:   [],
      connected:   row.my_kind   === 'like',
      waved:       row.my_kind   === 'wave',
      theirKind:   row.their_kind || null,
      isMatch:     !!row.is_match,
    };
  }

  // Title row + location pill + inbound strip + filter chips
  const ListHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>Your Matches</Text>
        <Pill
          label={`${matches.length} nearby`}
          variant="sage"
          style={{ alignSelf: 'flex-end', marginBottom: 4 }}
        />
      </View>

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

      <InboundStrip
        rows={pendingInbound}
        onTap={(row) => navigation?.navigate('MatchDetail', { match: inboundToMatch(row) })}
      />

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            active={activeFilter === f.id}
            onPress={() => setActiveFilter(f.id)}
          />
        ))}
      </View>
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
          <Text style={styles.stateTitle}>Couldn't load matches</Text>
          <Text style={styles.stateBody}>{error}</Text>
          <Text style={styles.stateHint}>Pull down to retry.</Text>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
        <Text style={styles.stateTitle}>No matches yet</Text>
        <Text style={styles.stateBody}>
          As more local Christians join, we'll surface the best fits for you here.
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
        <IconButton onPress={() => navigation?.navigate('Activity')}>
          <Ionicons name="notifications-outline" size={18} color={COLORS.text} />
        </IconButton>
      </Animated.View>

      {/* ── Match cards — paddingTop reserves room under the fixed header ── */}
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyState}
        renderItem={({ item }) => (
          <PersonCard
            match={item}
            onConnect={() => handleConnect(item.id)}
            onWave={() => handleWave(item.id)}
            onCancel={(kind) => handleCancel(item.id, kind)}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

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
    paddingTop: SPACING.sm,
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
    flexWrap: 'wrap',
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
});
