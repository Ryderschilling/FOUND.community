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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../theme';
import PersonCard from '../components/PersonCard';
import InboundStrip from '../components/InboundStrip';
import { Wordmark, Chip, Pill, IconButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

const FILTERS = [
  { id: 'all',    label: 'All'         },
  { id: 'near',   label: 'Near Me'     },
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

  const headerTranslate = useRef(new Animated.Value(0)).current;
  const lastScrollY     = useRef(0);
  const headerVisible   = useRef(true);

  const loadMatches = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // Matches feed + inbound (people who connected/waved at me) in parallel.
      // p_limit bumped to 100 — at MVP scale we want to surface every
      // onboarded profile even if scores are low. Filtering/sort comes later.
      const [matchesRes, inboundRes] = await Promise.all([
        supabase.rpc('top_matches_detailed', { p_limit: 100 }),
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
  }, [user]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Optimistic Connect: card already flipped its own state on press; we just
  // persist. RLS allows insert where from_profile = auth.uid().
  // PK is (from_profile, to_profile, kind) so re-tap is a no-op (handled by
  // on conflict do nothing via upsert).
  const handleConnect = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: toProfileId, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (insErr) console.warn('[discover] connect failed', insErr.message);
  }, [user]);

  // Wave = softer "hi" signal. Same upsert pattern with kind='wave'.
  const handleWave = useCallback(async (toProfileId) => {
    if (!user || !toProfileId) return;
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: toProfileId, kind: 'wave' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (insErr) console.warn('[discover] wave failed', insErr.message);
  }, [user]);

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

  // Title row + inbound strip + filter chips
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

      <InboundStrip
        rows={inbound}
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
        <IconButton onPress={() => {}}>
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
