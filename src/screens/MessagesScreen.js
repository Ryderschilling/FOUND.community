import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, IconButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

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

function relativeTime(iso) {
  if (!iso) return '';
  const now = Date.now();
  const t   = new Date(iso).getTime();
  const s   = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60)        return `${s}s`;
  if (s < 3600)      return `${Math.floor(s / 60)}m`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

// ─── Row component ────────────────────────────────────────────────────────
function MessageRow({ item, onPress }) {
  const isGroup = item.kind === 'group';
  const name    = item.other_full_name || item.other_handle || 'Conversation';
  const preview = item.last_message_body || (item.kind === 'group' ? 'Group thread' : 'Say hi to start the conversation');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrap}>
        {isGroup ? (
          <View style={styles.groupAvatar}>
            <Ionicons name="people-outline" size={22} color={COLORS.textSecondary} />
          </View>
        ) : (
          <Avatar
            initials={initialsFor(name)}
            size={50}
            gradientColors={gradientFor(item.other_profile_id || name)}
          />
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.time}>{relativeTime(item.last_message_at)}</Text>
        {item.unread_count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unread_count}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function MessagesScreen({ navigation }) {
  const { user } = useAuth();
  const [threads, setThreads]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [opening, setOpening]       = useState(false);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { data, error } = await supabase.rpc('my_threads_detailed');
      if (error) throw error;
      setThreads(data ?? []);
    } catch (e) {
      console.warn('[messages] load failed', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh whenever the screen is focused (e.g. after coming back from Chat)
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => load({ isRefresh: true }));
    return unsub;
  }, [navigation, load]);

  function openThread(item) {
    navigation?.navigate('Chat', {
      thread_id: item.thread_id,
      other: {
        id:        item.other_profile_id,
        name:      item.other_full_name,
        initials:  initialsFor(item.other_full_name || item.other_handle),
        avatarColor: gradientFor(item.other_profile_id || item.other_full_name),
      },
    });
  }

  // Start a new thread with the contact picked from the compose modal.
  // start_direct_thread is find-or-create, so re-tapping the same person
  // just opens the existing thread.
  async function startThreadWith(contact) {
    if (opening) return;
    setOpening(true);
    const { data: threadId, error } = await supabase
      .rpc('start_direct_thread', { p_other: contact.profile_id });
    setOpening(false);
    if (error) {
      Alert.alert('Could not open chat', error.message);
      return;
    }
    setComposeOpen(false);
    navigation?.navigate('Chat', {
      thread_id: threadId,
      other: {
        id:          contact.profile_id,
        name:        contact.full_name || contact.handle || 'Friend',
        initials:    initialsFor(contact.full_name || contact.handle),
        avatarColor: gradientFor(contact.profile_id),
      },
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerMeta}>Inbox</Text>
          <Text style={styles.title}>Messages</Text>
        </View>
        <IconButton onPress={() => setComposeOpen(true)}>
          <Ionicons name="create-outline" size={18} color={COLORS.text} />
        </IconButton>
      </View>

      <ComposeModal
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPick={startThreadWith}
        busy={opening}
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.thread_id}
          renderItem={({ item }) => <MessageRow item={item} onPress={() => openThread(item)} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubbles-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyBody}>
                Tap a match in Discover, then "Send Message" to start one.
              </Text>
            </View>
          }
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

// ─── Compose modal ────────────────────────────────────────────────────────
// Bottom-sheet listing everyone I can message (people I've connected/waved
// with, either direction). Tap → start_direct_thread → Chat.
function ComposeModal({ visible, onClose, onPick, busy }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('messageable_contacts');
      if (error) console.warn('[compose] contacts failed', error.message);
      setContacts(data ?? []);
      setLoading(false);
    })();
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.headerRow}>
            <Text style={modalStyles.title}>New Message</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={modalStyles.centerPad}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : contacts.length === 0 ? (
            <View style={modalStyles.centerPad}>
              <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
              <Text style={modalStyles.emptyTitle}>No contacts yet</Text>
              <Text style={modalStyles.emptyBody}>
                Connect or wave at someone in Discover, then come back here to start a chat.
              </Text>
            </View>
          ) : (
            <FlatList
              data={contacts}
              keyExtractor={(c) => c.profile_id}
              renderItem={({ item }) => {
                const name = item.full_name || item.handle || 'Someone';
                return (
                  <TouchableOpacity
                    style={modalStyles.row}
                    onPress={() => onPick(item)}
                    disabled={busy}
                    activeOpacity={0.7}
                  >
                    <Avatar
                      initials={initialsFor(name)}
                      size={46}
                      gradientColors={gradientFor(item.profile_id)}
                      uri={item.avatar_url || undefined}
                    />
                    <View style={modalStyles.rowInfo}>
                      <Text style={modalStyles.rowName}>{name}</Text>
                      <Text style={modalStyles.rowMeta}>
                        {[item.life_stage_label, [item.city, item.state].filter(Boolean).join(', ')]
                          .filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {item.is_match ? (
                      <View style={modalStyles.matchPill}>
                        <Ionicons name="sparkles" size={10} color={COLORS.sage} />
                        <Text style={modalStyles.matchText}>Match</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={modalStyles.sep} />}
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  title: { fontFamily: FONT.serifItalic, fontSize: 24, color: COLORS.text },

  centerPad: { alignItems: 'center', padding: SPACING.xl, gap: 8 },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 18, color: COLORS.text, marginTop: 6 },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  rowMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary },
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.sageBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  matchText: { fontFamily: FONT.semiBold, fontSize: 10, color: COLORS.sage },
  sep: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 58 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 13,
  },
  avatarWrap: { position: 'relative', flexShrink: 0 },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 3, minWidth: 0 },
  name:    { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  preview: { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.textSecondary },
  right: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  time:  { fontFamily: FONT.regular, fontSize: 11, color: COLORS.textTertiary },
  badge: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.full,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: 11, fontFamily: FONT.bold },
  separator: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 78 },

  emptyWrap: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING['2xl'] ?? 48,
  },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text, marginTop: 4 },
  emptyBody: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
});
