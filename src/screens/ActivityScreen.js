// ─────────────────────────────────────────────────────────────────────────
// ActivityScreen — your inbox of inbound connection requests, waves, matches
//
// Sources data from `inbound_connections()` RPC.
// Each row renders an action pair:
//   - Inbound "like" (request)   → [Accept] [Dismiss]
//   - Inbound "wave"             → [Connect Back] [Dismiss]
//   - Inbound + you've reciprocated (match) → [Message] [View]
//
// Accept = upsert reciprocal connections row (kind='like'), which causes the
// next refresh on either side to surface is_match=true and unlock messaging.
// Dismiss = soft hide (RPC dismiss_inbound) — the underlying like/wave row
// stays, so the sender can still appear in the matches feed.
// On screen focus we call mark_inbound_seen(NULL) so the tab badge clears.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Wordmark, IconButton } from '../components/Atoms';
import ScoreRing from '../components/ScoreRing';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';

// ─── Helpers ──────────────────────────────────────────────────────────────
// Neutral monochrome avatar palette — matches HomeScreen.
const AVATAR_GRADIENTS = [
  ['#1A1A1A', '#3A3A3A'], ['#2A2A2A', '#4A4A4A'], ['#3A3A3A', '#5A5A5A'],
  ['#1A1A1A', '#2A2A2A'], ['#4A4A4A', '#1A1A1A'], ['#2A2A2A', '#1A1A1A'],
  ['#3A3A3A', '#1A1A1A'], ['#5A5A5A', '#2A2A2A'],
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
function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60)        return 'just now';
  if (sec < 3600)      return `${Math.floor(sec / 60)}m`;
  if (sec < 86400)     return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800)    return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / 604800)}w`;
}

// Pick the headline + accent based on row state.
function summaryFor(row) {
  if (row.is_match) {
    return { tag: 'FOUND',   verb: 'FOUND!',          icon: 'sparkles',   color: COLORS.text  };
  }
  if (row.their_kind === 'like') {
    return { tag: 'REQUEST', verb: 'wants to connect', icon: 'heart',    color: COLORS.clay  };
  }
  if (row.their_kind === 'wave') {
    return { tag: 'WAVE',    verb: 'waved at you',     icon: 'hand-left', color: COLORS.gold };
  }
  return { tag: '', verb: '', icon: 'ellipsis-horizontal', color: COLORS.textTertiary };
}

// ─── Row ──────────────────────────────────────────────────────────────────
function ActivityRow({ row, onAccept, onDismiss, onOpen, onMessage, busy }) {
  const name    = row.full_name || row.handle || 'Someone';
  const initials = initialsFor(name);
  const grad    = gradientFor(row.profile_id);
  const meta    = summaryFor(row);
  const unseen  = !row.seen_at;

  // What action buttons to show
  const isMatch = row.is_match;
  const isAcceptedRequest = row.my_kind === 'like' && row.their_kind === 'like'; // == match

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.row, unseen && styles.rowUnseen]}
      onPress={() => onOpen?.(row)}
    >
      {/* Unseen dot */}
      {unseen ? <View style={styles.unseenDot} /> : null}

      <Avatar
        initials={initials}
        size={48}
        gradientColors={grad}
        uri={row.avatar_url || undefined}
      />

      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowTime}>{timeAgo(row.created_at)}</Text>
        </View>

        <View style={styles.rowVerb}>
          <Ionicons name={meta.icon} size={12} color={meta.color} />
          <Text style={[styles.rowVerbText, { color: meta.color }]}>{meta.verb}</Text>
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          {isMatch ? (
            <>
              <TouchableOpacity style={styles.btnPrimary} onPress={() => onMessage?.(row)}>
                <Ionicons name="chatbubble-outline" size={14} color={COLORS.white} />
                <Text style={styles.btnPrimaryText}>Message</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.btnPrimary}
                onPress={() => onAccept?.(row)}
                disabled={busy}
              >
                <Ionicons name="checkmark" size={14} color={COLORS.white} />
                <Text style={styles.btnPrimaryText}>
                  {row.their_kind === 'wave' ? 'Connect Back' : 'Accept'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnGhost}
                onPress={() => onDismiss?.(row)}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Dismiss</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Connection row (Connected tab) ──────────────────────────────────────
function ConnectionRow({ row, onPress, onPin }) {
  const name    = row.full_name || row.handle || 'Someone';
  const initials = initialsFor(name);
  const grad    = gradientFor(row.profile_id);
  const location = [row.city, row.state].filter(Boolean).join(', ');
  const interests = (row.activities ?? []).slice(0, 3).map(a => a.label).join(' · ');
  const isPinned = !!row.pinned_at;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.connRow}
      onPress={() => onPress?.(row)}
    >
      <Avatar
        initials={initials}
        size={48}
        gradientColors={grad}
        uri={row.avatar_url || undefined}
      />
      <View style={styles.connBody}>
        <View style={styles.connTopLine}>
          <Text style={styles.connName} numberOfLines={1}>{name}</Text>
          {row.score != null ? (
            <ScoreRing score={row.score} size={36} stroke={3} />
          ) : null}
        </View>
        {row.life_stage_label ? (
          <Text style={styles.connMeta} numberOfLines={1}>{row.life_stage_label}{location ? ` · ${location}` : ''}</Text>
        ) : location ? (
          <Text style={styles.connMeta} numberOfLines={1}>{location}</Text>
        ) : null}
        {interests ? (
          <Text style={styles.connInterests} numberOfLines={1}>{interests}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation?.(); onPin?.(row); }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={{ padding: 6, alignSelf: 'center' }}
        activeOpacity={0.7}
      >
        <Ionicons
          name={isPinned ? 'bookmark' : 'bookmark-outline'}
          size={18}
          color={isPinned ? COLORS.sage : COLORS.textTertiary}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
// ─── Event card (horizontal strip) ───────────────────────────────────────
function formatEventShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + '\n'
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function EventCard({ ev, onPress }) {
  const isCreator = ev.my_role === 'creator';
  return (
    <TouchableOpacity style={styles.eventCard} activeOpacity={0.8} onPress={() => onPress(ev)}>
      <View style={[styles.eventRolePill, isCreator ? styles.eventRoleCreator : styles.eventRoleAttendee]}>
        <Text style={[styles.eventRoleText, isCreator ? styles.eventRoleCreatorText : styles.eventRoleAttendeeText]}>
          {isCreator ? 'Hosting' : 'Going'}
        </Text>
      </View>
      <Text style={styles.eventCardTitle} numberOfLines={2}>{ev.title}</Text>
      <Text style={styles.eventCardTime}>{formatEventShort(ev.event_time)}</Text>
      {ev.location_name ? (
        <Text style={styles.eventCardLocation} numberOfLines={1}>📍 {ev.location_name}</Text>
      ) : null}
      {ev.going_count > 0 && (
        <Text style={styles.eventCardGoing}>{ev.going_count} going</Text>
      )}
    </TouchableOpacity>
  );
}

export default function ActivityScreen({ navigation }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  // ── Segment control ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('requests'); // 'requests' | 'connected'

  // ── Requests tab state ──────────────────────────────────────────────────
  const [rows, setRows]               = useState([]);
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);
  const [busyProfileId, setBusyProfileId] = useState(null);
  const [markingAll,   setMarkingAll]    = useState(false);

  // ── Connected tab state ─────────────────────────────────────────────────
  const [connections,        setConnections]        = useState([]);
  const [connLoading,        setConnLoading]        = useState(false);
  const [connRefreshing,     setConnRefreshing]     = useState(false);
  const [connSearch,         setConnSearch]         = useState('');
  const [connSort,           setConnSort]           = useState('recent'); // 'recent' | 'score' | 'name'

  // Guard against setState after unmount / after blur
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (!user || !mountedRef.current) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [connRes, evRes] = await Promise.all([
        supabase.rpc('inbound_connections'),
        supabase.rpc('my_upcoming_events'),
      ]);
      if (!mountedRef.current) return;
      if (connRes.error) throw connRes.error;
      setRows(connRes.data ?? []);
      setEvents(evRes.data ?? []);
    } catch (e) {
      if (!mountedRef.current) return;
      console.warn('[activity] load failed', e?.message);
      setError(e?.message ?? 'Could not load activity.');
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const loadConnections = useCallback(async ({ isRefresh } = {}) => {
    if (!user || !mountedRef.current) return;
    if (isRefresh) setConnRefreshing(true); else setConnLoading(true);
    try {
      const { data, error } = await supabase.rpc('my_connections');
      if (!mountedRef.current) return;
      if (error) { console.warn('[activity] my_connections failed', error.message); return; }
      setConnections(data ?? []);
    } finally {
      if (!mountedRef.current) return;
      setConnLoading(false);
      setConnRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Filtered + sorted connections list (client-side — cap is a few hundred rows)
  const visibleConnections = useMemo(() => {
    let list = [...connections];
    const q = connSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const haystack = [
          r.full_name, r.handle, r.bio, r.life_stage_label, r.city, r.state,
          ...(r.activities ?? []).map(a => a.label),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }
    if (connSort === 'score') {
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    } else if (connSort === 'name') {
      list.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    }
    // Pinned always float to top regardless of sort mode
    list.sort((a, b) => {
      if (a.pinned_at && !b.pinned_at) return -1;
      if (!a.pinned_at && b.pinned_at) return 1;
      return 0;
    });
    return list;
  }, [connections, connSearch, connSort]);

  // Refresh + mark-all-seen whenever the user lands on this tab.
  // We track a per-focus abort flag so a load that starts on Activity but
  // completes after the user has already switched to Discover doesn't write
  // stale state back. This is what was causing the nav glitch.
  useEffect(() => {
    let abortFocus = false;
    const unsubFocus = navigation?.addListener?.('focus', () => {
      abortFocus = false;
      load({ isRefresh: true });
      loadConnections({ isRefresh: true });
      Promise.resolve(supabase.rpc('mark_inbound_seen', { p_from: null })).catch(() => {});
    });
    const unsubBlur = navigation?.addListener?.('blur', () => {
      abortFocus = true;
    });
    return () => {
      unsubFocus?.();
      unsubBlur?.();
    };
  }, [navigation, load, loadConnections]);

  // Accept = reciprocal like. Updates the row optimistically to "match" state
  // and offers to jump straight into a chat — biggest "what now?" moment
  // in the app, so make the next step obvious.
  async function handleAccept(row) {
    if (!user || !row?.profile_id) return;
    setBusyProfileId(row.profile_id);
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: row.profile_id, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (!mountedRef.current) return;
    setBusyProfileId(null);
    if (insErr) {
      toast({ title: 'Could not accept', message: insErr.message, type: 'error' });
      return;
    }

    // Determine whether this acceptance produced a match (their kind was already 'like').
    const becameMatch = row.their_kind === 'like';

    // Optimistic row update — flips the action buttons from Accept/Dismiss → Message/Clear
    setRows((prev) =>
      prev.map((r) =>
        r.profile_id === row.profile_id
          ? { ...r, my_kind: 'like', is_match: becameMatch }
          : r
      )
    );

    // Confirmation + jump-into-chat shortcut
    const name = row.full_name || row.handle || 'them';
    if (becameMatch) {
      const ok = await confirm({
        title: 'FOUND!',
        message: `You and ${name} are now connected. Say hi?`,
        confirmLabel: 'Send a message',
        cancelLabel: 'Later',
      });
      if (ok) openChatWith(row);
    }
  }

  // Open a thread with the given activity row's profile.
  async function openChatWith(row) {
    if (!user || !row?.profile_id) return;
    const { data: threadId, error } = await supabase
      .rpc('start_direct_thread', { p_other: row.profile_id });
    if (error) {
      toast({ title: 'Could not open chat', message: error.message, type: 'error' });
      return;
    }
    navigation?.navigate('Chat', {
      thread_id: threadId,
      other: {
        id:          row.profile_id,
        name:        row.full_name || row.handle || 'Friend',
        initials:    initialsFor(row.full_name || row.handle),
        avatarColor: gradientFor(row.profile_id),
      },
    });
  }

  // Dismiss = soft hide; row leaves the list. Confirm first to avoid mis-taps.
  async function handleDismiss(row) {
    if (!user || !row?.profile_id) return;
    const ok = await confirm({
      title: 'Dismiss?',
      message: 'Dismiss this from your activity?',
      confirmLabel: 'Dismiss',
      destructive: true,
    });
    if (!ok) return;
    setBusyProfileId(row.profile_id);
    const { error: rpcErr } = await supabase.rpc('dismiss_inbound', { p_from: row.profile_id });
    if (!mountedRef.current) return;
    setBusyProfileId(null);
    if (rpcErr) {
      toast({ title: 'Could not dismiss', message: rpcErr.message, type: 'error' });
      return;
    }
    setRows((prev) => prev.filter((r) => r.profile_id !== row.profile_id));
  }

  function handleConnOpen(row) {
    navigation?.navigate('MatchDetail', {
      match: {
        id:          row.profile_id,
        name:        row.full_name || row.handle || 'Someone',
        handle:      row.handle || null,
        bio:         row.bio || null,
        initials:    initialsFor(row.full_name || row.handle),
        avatarUrl:   row.avatar_url || null,
        avatarColor: gradientFor(row.profile_id),
        matchScore:  row.score ?? null,
        lifeStage:   row.life_stage_label || '',
        distance:    [row.city, row.state].filter(Boolean).join(', ') || '',
        cityState:   [row.city, row.state].filter(Boolean).join(', ') || null,
        church:      null,
        interests:   (row.activities ?? []),
        connected:   true,
        theirKind:   'like',
        isMatch:     true,
      },
    });
  }

  async function handlePin(row) {
    const nowPinned = !!row.pinned_at;
    // Optimistic update
    setConnections((prev) =>
      prev.map((c) =>
        c.profile_id === row.profile_id
          ? { ...c, pinned_at: nowPinned ? null : new Date().toISOString() }
          : c
      )
    );
    const fn = nowPinned ? 'unpin_connection' : 'pin_connection';
    const { error } = await supabase.rpc(fn, { p_profile: row.profile_id });
    if (error) {
      console.warn('[activity] pin failed', error.message);
      // Rollback
      setConnections((prev) =>
        prev.map((c) =>
          c.profile_id === row.profile_id
            ? { ...c, pinned_at: row.pinned_at }
            : c
        )
      );
    }
  }

  function handleOpen(row) {
    // Reuse MatchDetail — it already handles connect/wave/message CTAs.
    navigation?.navigate('MatchDetail', {
      match: {
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
        church:      null,
        interests:   [],
        connected:   row.my_kind   === 'like',
        theirKind:   row.their_kind || null,
        isMatch:     !!row.is_match,
      },
    });
  }

  async function handleMarkAllRead() {
    if (markingAll || rows.length === 0) return;
    setMarkingAll(true);
    await supabase.rpc('dismiss_all_inbound');
    if (!mountedRef.current) return;
    setMarkingAll(false);
    setRows([]);
  }

  const handleEventPress = useCallback((ev) => {
    navigation.navigate('EventDetail', {
      eventId:   ev.event_id,
      isCreator: ev.my_role === 'creator',
    });
  }, [navigation]);

  const Header = () => (
    <View>
      {/* Title row */}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.headerMeta}>Your Inbox</Text>
          <Wordmark size="md" label="FOUND" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {activeTab === 'requests' && rows.length > 0 ? (
            <TouchableOpacity
              style={styles.markAllBtn}
              onPress={handleMarkAllRead}
              disabled={markingAll}
              activeOpacity={0.7}
            >
              {markingAll
                ? <ActivityIndicator size="small" color={COLORS.textSecondary} />
                : <Text style={styles.markAllText}>Mark all read</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Segment control */}
      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[styles.segBtn, activeTab === 'requests' && styles.segBtnActive]}
          onPress={() => setActiveTab('requests')}
          activeOpacity={0.8}
        >
          <Text style={[styles.segLabel, activeTab === 'requests' && styles.segLabelActive]}>
            Requests {rows.length > 0 ? `(${rows.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segBtn, activeTab === 'connected' && styles.segBtnActive]}
          onPress={() => setActiveTab('connected')}
          activeOpacity={0.8}
        >
          <Text style={[styles.segLabel, activeTab === 'connected' && styles.segLabelActive]}>
            Connected {connections.length > 0 ? `(${connections.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Connected tab: search + sort */}
      {activeTab === 'connected' ? (
        <View style={styles.connControls}>
          {/* Search */}
          <View style={styles.connSearchBox}>
            <Ionicons name="search" size={15} color={COLORS.textTertiary} />
            <TextInput
              style={styles.connSearchInput}
              placeholder="Search connections…"
              placeholderTextColor={COLORS.textTertiary}
              value={connSearch}
              onChangeText={setConnSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {connSearch.length > 0 ? (
              <TouchableOpacity onPress={() => setConnSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {/* Sort chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
            {[
              { id: 'recent', label: 'Recent' },
              { id: 'score',  label: 'Best Match' },
              { id: 'name',   label: 'Name' },
            ].map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.sortChip, connSort === s.id && styles.sortChipActive]}
                onPress={() => setConnSort(s.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.sortChipText, connSort === s.id && styles.sortChipTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : (
        <>
          {/* Upcoming events — requests tab only */}
          {events.length > 0 && (
            <View style={styles.eventsSection}>
              <Text style={styles.eventsSectionLabel}>UPCOMING EVENTS</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.eventsScroll}
              >
                {events.map((ev) => (
                  <EventCard key={ev.event_id} ev={ev} onPress={handleEventPress} />
                ))}
              </ScrollView>
            </View>
          )}

          {/* Event promo card */}
          <View style={styles.eventPromoCard}>
            <View style={styles.eventPromoIcon}>
              <Ionicons name="calendar" size={20} color={COLORS.text} />
            </View>
            <View style={styles.eventPromoBody}>
              <Text style={styles.eventPromoTitle}>Host a gathering</Text>
              <Text style={styles.eventPromoSub}>Create an event and invite your connections.</Text>
            </View>
            <TouchableOpacity
              style={styles.eventPromoCta}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('CreateEvent')}
            >
              <Text style={styles.eventPromoCtaText}>Create</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const Empty = () => {
    if (loading) {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.stateBox}>
          <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.stateTitle}>Couldn't load activity</Text>
          <Text style={styles.stateBody}>{error}</Text>
          <Text style={styles.stateHint}>Pull down to retry.</Text>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="notifications-outline" size={32} color={COLORS.textTertiary} />
        <Text style={styles.stateTitle}>You're all caught up</Text>
        <Text style={styles.stateBody}>
          When someone wants to connect, you'll see them here.
        </Text>
      </View>
    );
  };

  const ConnectedEmpty = () => {
    if (connLoading) return <View style={styles.stateBox}><ActivityIndicator color={COLORS.textTertiary} /></View>;
    if (visibleConnections.length === 0 && connSearch.length > 0) {
      return (
        <View style={styles.stateBox}>
          <Ionicons name="search-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.stateTitle}>No results</Text>
          <Text style={styles.stateBody}>No connections match "{connSearch}".</Text>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="people-outline" size={32} color={COLORS.textTertiary} />
        <Text style={styles.stateTitle}>No connections yet</Text>
        <Text style={styles.stateBody}>When you mutually connect with someone, they'll show up here.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {activeTab === 'connected' ? (
        <FlatList
          data={visibleConnections}
          keyExtractor={(r) => r.profile_id}
          ListHeaderComponent={<Header />}
          ListEmptyComponent={<ConnectedEmpty />}
          renderItem={({ item }) => (
            <ConnectionRow row={item} onPress={handleConnOpen} onPin={handlePin} />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={connRefreshing}
              onRefresh={() => loadConnections({ isRefresh: true })}
              tintColor={COLORS.textTertiary}
            />
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.profile_id}
          ListHeaderComponent={<Header />}
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => (
            <ActivityRow
              row={item}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
              onOpen={handleOpen}
              onMessage={openChatWith}
              busy={busyProfileId === item.profile_id}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ isRefresh: true })}
              tintColor={COLORS.textTertiary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  pageHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  markAllBtn: {
    paddingBottom: 4,
    minWidth: 40,
    alignItems: 'flex-end',
  },
  markAllText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  // Event discovery promo card
  eventPromoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.sm,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
  },
  eventPromoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventPromoBody: {
    flex: 1,
    gap: 2,
  },
  eventPromoTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  eventPromoSub: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
  eventPromoCta: {
    backgroundColor: COLORS.text,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  eventPromoCtaText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.white,
  },
  // Upcoming events strip
  eventsSection: {
    paddingBottom: SPACING.md,
  },
  eventsSectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: COLORS.textTertiary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  eventsScroll: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    paddingRight: SPACING.xl,
  },
  // Each card is a fixed-width vertical tile
  eventCard: {
    width: 160,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: 5,
    ...SHADOW.sm,
  },
  eventCardTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
  },
  eventCardTime: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  eventCardLocation: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  eventCardGoing: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: COLORS.sage,
  },
  eventRolePill: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    marginBottom: 2,
  },
  eventRoleCreator: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  eventRoleAttendee: {
    backgroundColor: COLORS.sageBg,
    borderColor: COLORS.sage,
  },
  eventRoleText: {
    fontFamily: FONT.semiBold,
    fontSize: 10,
  },
  eventRoleCreatorText: { color: COLORS.white },
  eventRoleAttendeeText: { color: COLORS.sage },
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

  list: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 110,
  },

  // Row
  row: {
    position: 'relative',
    flexDirection: 'row',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    ...SHADOW.sm,
  },
  rowUnseen: {
    // Subtle highlight; sage tinted background hint.
    borderColor: COLORS.sageMid ?? COLORS.border,
  },
  unseenDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.sage,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  rowName: {
    fontFamily: FONT.serifItalic,
    fontSize: 17,
    color: COLORS.text,
    flex: 1,
  },
  rowTime: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    color: COLORS.textTertiary,
  },
  rowVerb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: SPACING.sm,
  },
  rowVerbText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
  },

  actionRow: { flexDirection: 'row', gap: 8 },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 10,
  },
  btnPrimaryText: {
    fontFamily: FONT.bold,
    fontSize: 13,
    color: COLORS.white,
    letterSpacing: 0.2,
  },
  btnGhost: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // ── Segment control ─────────────────────────────────────────────
  segmentWrap: {
    flexDirection: 'row',
    marginHorizontal: SPACING.sm,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.full,
    padding: 3,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  segBtnActive: {
    backgroundColor: COLORS.white,
    ...SHADOW.sm,
  },
  segLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  segLabelActive: {
    color: COLORS.text,
  },

  // ── Connected tab controls ───────────────────────────────────────
  connControls: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  connSearchBox: {
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
  connSearchInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  sortRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: 2,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortChipActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  sortChipText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  sortChipTextActive: {
    color: COLORS.white,
  },

  // ── Connection row ───────────────────────────────────────────────
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    ...SHADOW.sm,
  },
  connBody: { flex: 1, gap: 3 },
  connTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  connName: {
    fontFamily: FONT.serifItalic,
    fontSize: 17,
    color: COLORS.text,
    flex: 1,
  },
  connMeta: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  connInterests: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },

  // State boxes
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
