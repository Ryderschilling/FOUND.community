// ─────────────────────────────────────────────────────────────────────────
// NotificationsFeedScreen — the in-app notification center.
//
// Opened from the bell in the Home header. Lists everything from the
// `notifications` table (migration 0027): new messages, group activity,
// connections and matches.
//
//   - Live: subscribes to realtime changes on the caller's rows.
//   - Tap a row  → marks it read + deep-links to the right place.
//   - Mark all read → clears every unread row.
//
// Connection / match rows deep-link into the Activity tab, where the
// Accept / Dismiss actions live.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import {
  fetchNotifications,
  markNotificationsRead,
} from '../lib/notifications';

// ─── Helpers ──────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60)     return 'just now';
  if (sec < 3600)   return `${Math.floor(sec / 60)}m`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / 604800)}w`;
}

// Icon + accent color per notification type.
function visualsFor(type) {
  switch (type) {
    case 'direct_message':
      return { icon: 'chatbubble',      fg: COLORS.sage, bg: COLORS.sageBg };
    case 'group_message':
      return { icon: 'chatbubbles',     fg: COLORS.sage, bg: COLORS.sageBg };
    case 'group_post':
      return { icon: 'newspaper',       fg: COLORS.clay, bg: COLORS.clayBg };
    case 'match':
      return { icon: 'sparkles',        fg: COLORS.gold, bg: COLORS.goldBg };
    case 'event_invite':
      return { icon: 'calendar',        fg: COLORS.clay, bg: COLORS.clayBg };
    case 'event_rsvp':
      return { icon: 'checkmark-circle',fg: COLORS.sage, bg: COLORS.sageBg };
    case 'church_welcome':
      return { icon: 'business',            fg: COLORS.sage, bg: COLORS.sageBg };
    case 'church_reply':
      return { icon: 'chatbubble-ellipses', fg: COLORS.sage, bg: COLORS.sageBg };
    case 'church_message':
      return { icon: 'mail',                fg: COLORS.gold, bg: COLORS.goldBg };
    case 'connection':
    default:
      return { icon: 'person-add',          fg: COLORS.warm, bg: COLORS.warmBg };
  }
}

// ─── Row ──────────────────────────────────────────────────────────────────
function NotificationRow({ item, onPress }) {
  const unread = !item.read_at;
  const v = visualsFor(item.type);
  return (
    <TouchableOpacity
      style={[styles.row, unread && styles.rowUnread]}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
    >
      <View style={[styles.iconWrap, { backgroundColor: v.bg }]}>
        <Ionicons name={v.icon} size={18} color={v.fg} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
        {item.body ? (
          <Text style={styles.rowSub} numberOfLines={1}>{item.body}</Text>
        ) : null}
        <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
      </View>
      {unread ? <View style={styles.unreadDot} /> : null}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function NotificationsFeedScreen({ navigation }) {
  const { user } = useAuth();

  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefresh]  = useState(false);
  const [error, setError]         = useState(null);

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    if (isRefresh) setRefresh(true);
    const { notifications, error: err } = await fetchNotifications(100);
    setItems(notifications);
    setError(err ? 'Could not load notifications.' : null);
    setLoading(false);
    setRefresh(false);

    // Auto-mark all unread as read when the feed is opened.
    // Covers notifications actioned outside this screen (e.g. connection
    // requests accepted via the Activity tab) that never got cleared.
    const hasUnread = notifications.some((n) => !n.read_at);
    if (hasUnread) {
      setItems((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })),
      );
      markNotificationsRead(null);
    }
  }, []);

  // Initial load + live updates.
  // NOTE: `load` is intentionally excluded from the deps array here.
  // Including it caused the channel to be recreated on every render that
  // touched `load` (e.g. after navigating away and back), which triggered
  // "cannot add postgres_changes callbacks after subscribe()".
  // We use a ref so the realtime callback always calls the latest `load`
  // without needing to recreate the channel.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    loadRef.current();
    if (!user?.id) return undefined;

    const chanName = `notifications-feed:${user.id}`;
    // Guard: remove any stale channel with this name before subscribing.
    // Supabase prefixes topics with 'realtime:' internally, so we must
    // compare against 'realtime:${chanName}', not chanName directly.
    supabase.getChannels().forEach((ch) => {
      if (ch.topic === `realtime:${chanName}`) supabase.removeChannel(ch);
    });

    const channel = supabase
      .channel(chanName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => { loadRef.current(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadCount = items.filter((n) => !n.read_at).length;

  const handleMarkAll = useCallback(async () => {
    if (unreadCount === 0) return;
    // Optimistic — realtime will reconcile.
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    await markNotificationsRead(null);
  }, [unreadCount]);

  const handleOpen = useCallback(async (n) => {
    // Mark this one read (optimistic) before navigating away.
    if (!n.read_at) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      markNotificationsRead([n.id]);
    }

    if (n.type === 'direct_message' && n.entity_id) {
      navigation?.navigate('Chat', {
        thread_id: n.entity_id,
        other: {
          id: n.actor_id,
          full_name: n.actor_name,
          avatar_url: n.actor_avatar_url,
        },
      });
    } else if ((n.type === 'group_message' || n.type === 'group_post') && n.entity_id) {
      navigation?.navigate('GroupDetail', { groupId: n.entity_id });
    } else if (n.type === 'match' && n.actor_id) {
      // Completed match — both sides connected. Go to their profile so the
      // user can see who it is and message them. Activity won't show completed
      // matches, only pending inbound requests.
      const name = n.actor_name || 'Someone';
      const parts = name.trim().split(/\s+/);
      const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '??';
      navigation?.navigate('MatchDetail', {
        match: {
          id:          n.actor_id,
          name,
          initials,
          avatarUrl:   n.actor_avatar_url || null,
          avatarColor: null,
          connected:   true,
          isMatch:     true,
          bio:         null,
          matchScore:  null,
          lifeStage:   '',
          distance:    '',
          church:      null,
          interests:   [],
          theirKind:   'like',
        },
      });
    } else if (n.type === 'connection' && n.actor_id) {
      // Inbound connection request → open their profile (MatchDetail) where
      // Accept / Ignore live. Avoids landing on the Activity tab when the
      // request has already been actioned (which would render an empty page).
      const name = n.actor_name || 'Someone';
      const parts = name.trim().split(/\s+/);
      const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '??';
      navigation?.navigate('MatchDetail', {
        match: {
          id:          n.actor_id,
          name,
          initials,
          avatarUrl:   n.actor_avatar_url || null,
          avatarColor: null,
          connected:   false,
          isMatch:     false,
          bio:         null,
          matchScore:  null,
          lifeStage:   '',
          distance:    '',
          church:      null,
          interests:   [],
          theirKind:   'like',
        },
      });
    } else if (n.type === 'event_invite' && n.entity_id) {
      navigation?.navigate('EventDetail', { eventId: n.entity_id, isCreator: false });
    } else if (n.type === 'event_rsvp' && n.entity_id) {
      navigation?.navigate('EventDetail', { eventId: n.entity_id, isCreator: true });
    } else if (n.type === 'church_welcome' && n.data?.church_id) {
      // Member just joined a church → show the church's profile.
      navigation?.navigate('ChurchProfile', { churchId: n.data.church_id });
    } else if (n.type === 'church_reply' && n.data?.church_id) {
      // Church replied to member's message → open the conversation thread.
      // Title format: "{church name} replied to your message"
      const churchName = n.title
        ? n.title.replace(/ replied to your message\.?$/i, '').trim()
        : 'Church';
      navigation?.navigate('ChurchInbox', {
        churchId:   n.data.church_id,
        churchName: churchName || 'Church',
      });
    } else {
      navigation?.navigate('Main', { screen: 'Activity' });
    }
  }, [navigation]);

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
          <Text style={styles.stateTitle}>Couldn't load notifications</Text>
          <Text style={styles.stateBody}>Pull down to retry.</Text>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="notifications-outline" size={32} color={COLORS.textTertiary} />
        <Text style={styles.stateTitle}>Nothing yet</Text>
        <Text style={styles.stateBody}>
          New messages, group activity and connections will show up here.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation?.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkAll} activeOpacity={0.7}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => (
          <NotificationRow item={item} onPress={handleOpen} />
        )}
        ListEmptyComponent={<Empty />}
        contentContainerStyle={items.length === 0 ? styles.listEmpty : styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
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
  headerTitle: {
    flex: 1,
    fontFamily: FONT.bold,
    fontSize: 20,
    color: COLORS.text,
  },
  headerSpacer: { width: 1 },
  markAll: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.sage,
  },

  list:      { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  listEmpty: { flexGrow: 1 },
  sep:       { height: 8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  rowUnread: {
    borderColor: COLORS.sage,
    backgroundColor: COLORS.sageBg,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 19,
  },
  rowSub: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  rowTime: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.sage,
  },

  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: 80,
    gap: 8,
  },
  stateTitle: {
    fontFamily: FONT.bold,
    fontSize: 16,
    color: COLORS.text,
    marginTop: 4,
  },
  stateBody: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
