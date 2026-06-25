// ─────────────────────────────────────────────────────────────────────────────
// GroupChatPanel
//
// Inline group chat UI — embedded inside GroupDetailScreen's Chat tab.
// Mirrors ChatScreen logic but without its own nav bar; designed to fill
// a flex container provided by the parent.
//
// Props:
//   threadId  uuid | null — null while open_group_thread is loading
//   groupId   uuid
//   members   array from group_members_list (pre-loaded by parent, avoids extra RPC)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { checkText } from '../lib/contentFilter';

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Bubble ──────────────────────────────────────────────────────────────────
function Bubble({ message, mine, sender, showSender }) {
  if (!mine) {
    return (
      <View style={[styles.bubbleWrap, styles.bubbleWrapThem]}>
        <View style={styles.bubbleRow}>
          {showSender ? (
            <Avatar
              initials={sender?.initials || '··'}
              size={26}
              gradientColors={sender?.gradient}
            />
          ) : (
            <View style={styles.avatarSpacer} />
          )}
          <View style={styles.bubbleCol}>
            {showSender ? (
              <Text style={styles.senderName}>{sender?.name || 'Member'}</Text>
            ) : null}
            <View style={[styles.bubble, styles.bubbleThem]}>
              <Text style={[styles.bubbleText, styles.bubbleTextThem]}>{message.body}</Text>
            </View>
            <Text style={styles.bubbleTime}>{formatTime(message.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrap, styles.bubbleWrapMe]}>
      <View style={[styles.bubble, styles.bubbleMe]}>
        <Text style={[styles.bubbleText, styles.bubbleTextMe]}>{message.body}</Text>
      </View>
      <Text style={styles.bubbleTime}>{formatTime(message.created_at)}</Text>
    </View>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────
export default function GroupChatPanel({ threadId, groupId, members = [] }) {
  const { user } = useAuth();
  const toast = useToast();
  const listRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);

  // Build senderMap from pre-loaded members — no extra RPC needed
  const senderMap = useMemo(() => {
    const map = {};
    for (const m of members) {
      const name = m.full_name || m.handle || 'Member';
      map[m.profile_id] = {
        name,
        initials: initialsFor(name),
        gradient: gradientFor(m.profile_id),
      };
    }
    return map;
  }, [members]);

  const markRead = useCallback(async () => {
    if (!user || !threadId) return;
    await Promise.all([
      supabase
        .from('thread_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('profile_id', user.id),
      supabase.rpc('mark_thread_notifications_read', { p_thread_id: threadId }),
    ]);
  }, [user, threadId]);

  // Initial message fetch
  useEffect(() => {
    if (!threadId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, thread_id, sender_id, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn('[group-chat] fetch failed', error.message);
      } else {
        setMessages(data ?? []);
      }
      setLoading(false);
      markRead();
    })();
    return () => { cancelled = true; };
  }, [threadId, markRead]);

  // Realtime subscription — append new messages as they arrive
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`thread:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const m = payload.new;
          setMessages((prev) => {
            // Replace optimistic temp message if our own send echoes back
            const withoutOptimistic = prev.filter(
              (x) => !(x._optimistic && x.body === m.body && x.sender_id === m.sender_id)
            );
            // De-dupe
            if (withoutOptimistic.some((x) => x.id === m.id)) return withoutOptimistic;
            return [...withoutOptimistic, m];
          });
          if (user && m.sender_id !== user.id) markRead();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [threadId, user, markRead]);

  async function handleSend() {
    const body = input.trim();
    if (!body || !threadId || !user || sending) return;

    const violation = checkText(body, 'message');
    if (!violation.ok) {
      toast({ title: 'Check your wording', message: violation.message, type: 'info' });
      return;
    }

    setSending(true);
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      thread_id: threadId,
      sender_id: user.id,
      body,
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');

    const { error } = await supabase
      .from('messages')
      .insert({ thread_id: threadId, sender_id: user.id, body });
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(body);
      toast({ title: 'Could not send', message: error.message, type: 'error' });
    }
    setSending(false);
  }

  // While the thread ID is loading, show a spinner
  if (!threadId) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={COLORS.textTertiary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubble-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>Say hi.</Text>
          <Text style={styles.emptyBody}>
            Be the first to post. Introduce yourself or share what's coming up.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => {
            const mine = !!user && item.sender_id === user.id;
            const prev = messages[index - 1];
            const showSender = !mine && (!prev || prev.sender_id !== item.sender_id);
            return (
              <Bubble
                message={item}
                mine={mine}
                sender={senderMap[item.sender_id]}
                showSender={showSender}
              />
            );
          }}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Composer */}
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={input}
          onChangeText={setInput}
          placeholder="Message the group…"
          placeholderTextColor={COLORS.textTertiary}
          multiline
          returnKeyType="default"
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
          activeOpacity={0.8}
        >
          <Ionicons
            name="arrow-up"
            size={18}
            color={input.trim() && !sending ? COLORS.white : COLORS.textTertiary}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: SPACING.xl,
  },
  emptyTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 22,
    color: COLORS.text,
    marginTop: 4,
  },
  emptyBody: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  messageList: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: 8,
  },

  bubbleWrap:     { marginVertical: 3 },
  bubbleWrapMe:   { alignItems: 'flex-end' },
  bubbleWrapThem: { alignItems: 'flex-start' },

  bubbleRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  avatarSpacer: { width: 26 },
  bubbleCol:    { alignItems: 'flex-start', flexShrink: 1 },
  senderName: {
    fontFamily: FONT.semiBold,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginBottom: 3,
    marginLeft: 4,
  },

  bubble: {
    maxWidth: '78%',
    borderRadius: RADIUS.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMe: {
    backgroundColor: COLORS.accent,
    borderBottomRightRadius: 6,
  },
  bubbleThem: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText:     { fontSize: 15, lineHeight: 21 },
  bubbleTextMe:   { fontFamily: FONT.regular, color: COLORS.white },
  bubbleTextThem: { fontFamily: FONT.regular, color: COLORS.text },
  bubbleTime: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginTop: 3,
    marginHorizontal: 4,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.lg : SPACING.sm,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  composerInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.border,
  },
});
