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

import { useState, useEffect, useCallback } from 'react';
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
 * @returns {{ count: number, refresh: () => Promise<void> }}
 */
export function useUnreadNotifications(userId) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCount(0);
      return;
    }
    const { count: c } = await fetchUnreadCount();
    setCount(c);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return undefined;
    }
    refresh();

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => { refresh(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, refresh]);

  return { count, refresh };
}
