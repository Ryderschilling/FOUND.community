// ─────────────────────────────────────────────────────────────────────────
// notifications.js
//
// Client layer for the in-app notification center (migration 0027).
//   - fetchNotifications()      → the feed
//   - fetchUnreadCount()        → header bell badge value
//   - markNotificationsRead()   → mark some / all read
//   - useUnreadNotifications()  → live badge count (realtime subscription)
//
// Rows are created server-side by DB triggers; the client only ever reads
// and marks-read.
// ─────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Load the caller's notification feed (most recent first).
 * @param {number} limit
 * @returns {Promise<{ notifications: object[], error: Error|null }>}
 */
export async function fetchNotifications(limit = 50) {
  const { data, error } = await supabase.rpc('list_notifications', {
    p_limit: limit,
  });
  if (error) return { notifications: [], error };
  return { notifications: data ?? [], error: null };
}

/**
 * Current unread count. Falls back to 0 on any error so the UI never breaks.
 * @returns {Promise<{ count: number, error: Error|null }>}
 */
export async function fetchUnreadCount() {
  const { data, error } = await supabase.rpc('unread_notification_count');
  if (error) return { count: 0, error };
  return { count: typeof data === 'number' ? data : 0, error: null };
}

/**
 * Mark notifications read.
 * @param {string[]|null} ids  null / empty → mark ALL read
 * @returns {Promise<{ error: Error|null }>}
 */
export async function markNotificationsRead(ids = null) {
  const { error } = await supabase.rpc('mark_notifications_read', {
    p_ids: ids && ids.length ? ids : null,
  });
  return { error };
}

/**
 * Live unread count for the header bell.
 * Fetches once, then re-fetches on any realtime change to the caller's rows
 * (new notification, or a read-state change made elsewhere in the app).
 *
 * @param {string|null|undefined} userId  auth user id
 * @param {string} [tag]  unique tag per call site — prevents Supabase from
 *   reusing the same channel object when two components subscribe for the
 *   same user (e.g. FloatingTabBar + HomeScreen), which would throw
 *   "cannot add postgres_changes callbacks after subscribe()".
 * @returns {{ count: number, refresh: () => Promise<void> }}
 */
export function useUnreadNotifications(userId, tag = 'default') {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) { setCount(0); return; }
    const { count: c } = await fetchUnreadCount();
    setCount(c);
  }, [userId]);

  // Keep a stable ref to the latest refresh so the realtime callback
  // never captures a stale closure, and so the effect dependency array
  // doesn't include `refresh` (which would recreate the channel on every
  // render and trigger the "cannot add callbacks after subscribe()" crash).
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!userId) { setCount(0); return undefined; }

    // Fire once on mount / userId change.
    refreshRef.current();

    const chanName = `notifications:${userId}:${tag}`;

    // Guard: if a channel with this exact name is already subscribed (e.g.
    // from a previous render cycle that didn't fully clean up), remove it
    // first so Supabase doesn't throw "cannot add callbacks after subscribe()".
    supabase.getChannels().forEach((ch) => {
      if (ch.topic === chanName) supabase.removeChannel(ch);
    });

    const channel = supabase
      .channel(chanName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => { refreshRef.current(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, tag]); // intentionally excludes `refresh` — use refreshRef instead

  return { count, refresh };
}
