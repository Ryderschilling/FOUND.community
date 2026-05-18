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

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  ['#4A6FA5', '#2D4E8A'], ['#5A8A6A', '#3D6B55'], ['#C0795A', '#A0593A'],
  ['#7A5AA8', '#5A3A88'], ['#A8793A', '#886020'], ['#5A7A4A', '#3D6B3E'],
  ['#4A8A6A', '#2D6B55'], ['#7A846A', '#5A6450'],
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
    return { tag: 'MATCH',   verb: "It's a match!",  icon: 'sparkles',   color: COLORS.sage  };
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
function ActivityRow({ row, onAccept, onDismiss, onOpen, busy }) {
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
              <TouchableOpacity style={styles.btnPrimary} onPress={() => onOpen?.(row)}>
                <Ionicons name="chatbubble-outline" size={14} color={COLORS.white} />
                <Text style={styles.btnPrimaryText}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnGhost}
                onPress={() => onDismiss?.(row)}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Clear</Text>
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

// ─── Screen ───────────────────────────────────────────────────────────────
export default function ActivityScreen({ navigation }) {
  const { user } = useAuth();
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState(null);
  const [busyProfileId, setBusyProfileId] = useState(null);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('inbound_connections');
      if (rpcErr) throw rpcErr;
      setRows(data ?? []);
    } catch (e) {
      console.warn('[activity] load failed', e?.message);
      setError(e?.message ?? 'Could not load activity.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Refresh + mark-all-seen whenever the user lands on this tab.
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', async () => {
      load({ isRefresh: true });
      // Fire-and-forget; tab badge updates on next poll.
      supabase.rpc('mark_inbound_seen', { p_from: null }).catch(() => {});
    });
    return unsub;
  }, [navigation, load]);

  // Accept = reciprocal like. Updates the row optimistically to "match" state.
  async function handleAccept(row) {
    if (!user || !row?.profile_id) return;
    setBusyProfileId(row.profile_id);
    const { error: insErr } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: row.profile_id, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    setBusyProfileId(null);
    if (insErr) {
      Alert.alert('Could not accept', insErr.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.profile_id === row.profile_id
          ? { ...r, my_kind: 'like', is_match: r.their_kind === 'like' }
          : r
      )
    );
  }

  // Dismiss = soft hide; row leaves the list. Confirm first to avoid mis-taps.
  async function handleDismiss(row) {
    if (!user || !row?.profile_id) return;
    const doIt = async () => {
      setBusyProfileId(row.profile_id);
      const { error: rpcErr } = await supabase.rpc('dismiss_inbound', { p_from: row.profile_id });
      setBusyProfileId(null);
      if (rpcErr) {
        Alert.alert('Could not dismiss', rpcErr.message);
        return;
      }
      setRows((prev) => prev.filter((r) => r.profile_id !== row.profile_id));
    };

    const msg = 'Dismiss this from your activity?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) doIt();
      return;
    }
    Alert.alert('Dismiss?', msg, [
      { text: 'Cancel',  style: 'cancel' },
      { text: 'Dismiss', style: 'destructive', onPress: doIt },
    ]);
  }

  function handleOpen(row) {
    // Reuse MatchDetail — it already handles connect/wave/message CTAs.
    navigation?.navigate('MatchDetail', {
      match: {
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
      },
    });
  }

  const Header = () => (
    <View style={styles.pageHeader}>
      <Text style={styles.headerMeta}>Your Inbox</Text>
      <Text style={styles.pageTitle}>Activity</Text>
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
          When someone connects or waves, you'll see them here.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

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
