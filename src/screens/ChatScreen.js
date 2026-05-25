import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from '../components/Atoms';
import ReportSheet from '../components/ReportSheet';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';

// ─── Helpers ──────────────────────────────────────────────────────────────
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

function Bubble({ message, mine, isGroup, sender, showSender }) {
  // Group threads: other people's messages get a sender avatar + name.
  // showSender is false for consecutive messages from the same person, so a
  // run of messages reads as one block instead of repeating the name.
  if (isGroup && !mine) {
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
    <View style={[styles.bubbleWrap, mine ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
      <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleThem]}>
        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMe : styles.bubbleTextThem]}>
          {message.body}
        </Text>
      </View>
      <Text style={styles.bubbleTime}>{formatTime(message.created_at)}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function ChatScreen({ route, navigation }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const params = route?.params ?? {};

  // Accept either { thread_id, other: {id, name, ...} } or the older { thread: {...} }
  const threadId = params.thread_id ?? params.threadId ?? null;
  const other = params.other ?? params.thread ?? null;

  // Group mode — set by GroupDetailScreen ("Open Group Chat")
  const isGroup   = !!params.isGroup;
  const group     = params.group ?? null;
  const groupId   = group?.id ?? params.group_id ?? null;
  const groupName = group?.name || 'Group';

  const otherName     = other?.name || other?.full_name || 'Friend';
  const otherInitials = other?.initials || initialsFor(otherName);
  const otherGradient = other?.avatarColor || gradientFor(other?.id || other?.profile_id || otherName);
  const otherProfileId = other?.id || other?.profile_id || null;

  const [messages, setMessages]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const [senderMap, setSenderMap] = useState({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const listRef = useRef(null);

  // Group mode: load the roster once so each message can show a name + avatar.
  useEffect(() => {
    if (!isGroup || !groupId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('group_members_list', { p_group: groupId });
      if (cancelled || error || !data) return;
      const map = {};
      for (const m of data) {
        const name = m.full_name || m.handle || 'Member';
        map[m.profile_id] = {
          name,
          initials: initialsFor(name),
          gradient: gradientFor(m.profile_id),
        };
      }
      setSenderMap(map);
    })();
    return () => { cancelled = true; };
  }, [isGroup, groupId]);

  // Mark current thread as read for me
  const markRead = useCallback(async () => {
    if (!user || !threadId) return;
    await supabase
      .from('thread_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('profile_id', user.id);
  }, [user, threadId]);

  // Initial fetch
  useEffect(() => {
    if (!threadId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, thread_id, sender_id, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn('[chat] fetch failed', error.message);
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
            // Replace optimistic temp message if it's our own send echoing back
            const withoutOptimistic = prev.filter(
              (x) => !(x._optimistic && x.body === m.body && x.sender_id === m.sender_id)
            );
            // De-dupe if already present
            if (withoutOptimistic.some((x) => x.id === m.id)) return withoutOptimistic;
            return [...withoutOptimistic, m];
          });
          // If incoming was from the other person, mark read
          if (user && m.sender_id !== user.id) markRead();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, user, markRead]);

  async function handleSend() {
    const body = input.trim();
    if (!body || !threadId || !user || sending) return;
    setSending(true);
    // Optimistic insert
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
      // Roll back optimistic + warn
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(body);
      Alert.alert('Could not send', error.message);
    }
    setSending(false);
  }

  const handleBlock = async () => {
    setMoreMenuOpen(false);
    const ok = await confirm({
      title: 'Block user?',
      message: `${otherName} will not be able to see your profile or message you.`,
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok || !otherProfileId) return;

    try {
      const { error } = await supabase.rpc('block_user', {
        p_target: otherProfileId,
      });
      if (error) {
        Alert.alert('Could not block', error.message || 'Try again.');
      } else {
        navigation.goBack();
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Something went wrong.');
    }
  };

  const handleReport = () => {
    setMoreMenuOpen(false);
    setReportOpen(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Nav bar */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        {isGroup ? (
          <TouchableOpacity
            style={styles.navCenter}
            activeOpacity={0.7}
            onPress={() => { if (groupId) navigation.navigate('GroupDetail', { groupId }); }}
          >
            <View style={[styles.groupIconWrap, { backgroundColor: group?.iconBg ?? COLORS.sageBg }]}>
              <Ionicons name={group?.icon ?? 'people'} size={18} color={group?.iconColor ?? COLORS.sage} />
            </View>
            <View>
              <Text style={styles.navName} numberOfLines={1}>{groupName}</Text>
              <Text style={styles.navStatus}>Group chat</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.navCenter}>
            <Avatar
              initials={otherInitials}
              size={34}
              gradientColors={otherGradient}
            />
            <View>
              <Text style={styles.navName}>{otherName}</Text>
              <Text style={styles.navStatus}>Connected via FOUND</Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.moreBtn}
          activeOpacity={0.7}
          onPress={() => {
            if (isGroup && groupId) {
              navigation.navigate('GroupDetail', { groupId });
            } else if (!isGroup) {
              setMoreMenuOpen(true);
            }
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.navRule} />

      {/* Message list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubble-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>Say hi.</Text>
          <Text style={styles.emptyBody}>
            {isGroup
              ? 'Be the first to post. Introduce yourself or share what\u2019s coming up.'
              : 'Open with what you have in common — life stage, an interest, your church.'}
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
            // First message of a sender-run shows the avatar + name.
            const showSender =
              isGroup && !mine && (!prev || prev.sender_id !== item.sender_id);
            return (
              <Bubble
                message={item}
                mine={mine}
                isGroup={isGroup}
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={input}
            onChangeText={setInput}
            placeholder="Message..."
            placeholderTextColor={COLORS.textTertiary}
            multiline
            returnKeyType="default"
            editable={!!threadId && !sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || !threadId || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || !threadId || sending}
            activeOpacity={0.8}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={input.trim() && threadId && !sending ? COLORS.white : COLORS.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Action menu for direct threads */}
      {!isGroup && (
        <>
          <Modal
            visible={moreMenuOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setMoreMenuOpen(false)}
          >
            <TouchableOpacity
              style={styles.menuBackdrop}
              activeOpacity={1}
              onPress={() => setMoreMenuOpen(false)}
            >
              <View style={styles.menuSheet}>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleBlock}
                  activeOpacity={0.7}
                >
                  <Ionicons name="ban-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuItemText}>Block</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleReport}
                  activeOpacity={0.7}
                >
                  <Ionicons name="flag-outline" size={18} color={COLORS.text} />
                  <Text style={styles.menuItemText}>Report</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          <ReportSheet
            visible={reportOpen}
            targetKind="profile"
            targetId={otherProfileId}
            onClose={() => setReportOpen(false)}
            onReported={() => setReportOpen(false)}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  backArrow: { fontSize: 18, color: COLORS.text },
  navCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  groupIconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navName: { fontFamily: FONT.serifItalic, fontSize: 17, color: COLORS.text },
  navStatus: { fontFamily: FONT.mono, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: COLORS.textTertiary },
  moreBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRule: { height: 1, backgroundColor: COLORS.borderLight, marginHorizontal: SPACING.lg },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: SPACING.xl },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text, marginTop: 4 },
  emptyBody: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },

  messageList: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: 8,
  },

  bubbleWrap: { marginVertical: 3 },
  bubbleWrapMe:   { alignItems: 'flex-end' },
  bubbleWrapThem: { alignItems: 'flex-start' },

  // Group mode: avatar + sender name beside other people's bubbles
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  avatarSpacer: { width: 26 },
  bubbleCol: { alignItems: 'flex-start', flexShrink: 1 },
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
  bubbleText: { fontSize: 15, lineHeight: 21 },
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

  // Action menu
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
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
