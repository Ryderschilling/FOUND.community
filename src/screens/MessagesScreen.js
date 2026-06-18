import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Platform,
  TextInput,
  Animated,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, IconButton, Wordmark } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useProfileGate } from '../lib/useProfileGate';
import { useToast } from '../components/ToastProvider';

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
function relativeTime(iso) {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60)        return `${s}s`;
  if (s < 3600)      return `${Math.floor(s / 60)}m`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

// ─── Thread row ───────────────────────────────────────────────────────────
function MessageRow({ item, onPress }) {
  const isGroup  = item.kind === 'group';
  const isChurch = item.kind === 'church';
  const name     = item.other_full_name || item.other_handle || 'Conversation';
  const rawBody  = item.last_message_body || (isGroup ? 'Group thread' : 'Say hi!');
  const preview  = item.last_message_is_mine ? `You: ${rawBody}` : rawBody;
  const unread   = item.unread_count ?? 0;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrap}>
        {isGroup ? (
          <View style={styles.groupAvatar}>
            <Ionicons name="people-outline" size={22} color={COLORS.textSecondary} />
          </View>
        ) : isChurch ? (
          <View style={styles.churchAvatar}>
            {item.church_logo_url ? (
              <Avatar
                initials={initialsFor(name)}
                size={50}
                gradientColors={['#1a1a1a', '#333333']}
                uri={item.church_logo_url}
              />
            ) : (
              <View style={styles.churchAvatarFallback}>
                <Ionicons name="business-outline" size={22} color="#fff" />
              </View>
            )}
          </View>
        ) : (
          <Avatar
            initials={initialsFor(name)}
            size={50}
            gradientColors={gradientFor(item.other_profile_id || name)}
            uri={item.other_avatar_url || undefined}
          />
        )}
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {isChurch && <Text style={styles.churchLabel}>Church</Text>}
          {isGroup  && <Text style={styles.groupLabel}>(group)</Text>}
        </View>
        <Text style={[styles.preview, unread > 0 && styles.previewUnread]} numberOfLines={1}>{preview}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.time}>{relativeTime(item.last_message_at)}</Text>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function MessagesScreen({ navigation }) {
  const { user } = useAuth();
  const { checkGate, ProfileGateModal } = useProfileGate(navigation);
  const toast = useToast();
  const [threads,      setThreads]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  const [composeOpen,  setComposeOpen]  = useState(false);
  const [opening,      setOpening]      = useState(false);
  const [activeTab,    setActiveTab]    = useState('all');   // 'all' | 'new' | 'groups'
  const [hideGroups,   setHideGroups]   = useState(false);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [threadsRes, churchRes] = await Promise.all([
        supabase.rpc('my_threads_detailed'),
        supabase.rpc('my_church_conversations'),
      ]);

      if (threadsRes.error) throw threadsRes.error;

      const withMessages = (threadsRes.data ?? []).filter((t) => t.last_message_body != null);

      // Shape church conversations to match thread row format
      const churchThreads = (churchRes.data ?? []).map((c) => ({
        thread_id:            c.church_id,   // reuse field as unique key
        kind:                 'church',
        church_id:            c.church_id,
        church_logo_url:      c.church_logo_url,
        other_full_name:      c.church_name,
        last_message_body:    c.last_message_body,
        last_message_at:      c.last_message_at,
        last_message_is_mine: c.last_message_is_mine,
        unread_count:         c.unread_reply_count,
      }));

      // Merge + sort by most recent activity
      const all = [...withMessages, ...churchThreads].sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });

      setThreads(all);
    } catch (e) {
      console.warn('[messages] load failed', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => load({ isRefresh: true }));
    return unsub;
  }, [navigation, load]);

  function openThread(item) {
    if (item.kind === 'church') {
      navigation?.navigate('ChurchInbox', {
        churchId:   item.church_id,
        churchName: item.other_full_name,
      });
      return;
    }
    if (item.kind === 'group') {
      navigation?.navigate('Chat', {
        thread_id: item.thread_id,
        isGroup: true,
        group: { id: item.group_id, name: item.other_full_name },
      });
      return;
    }
    navigation?.navigate('Chat', {
      thread_id: item.thread_id,
      other: {
        id:          item.other_profile_id,
        name:        item.other_full_name,
        initials:    initialsFor(item.other_full_name || item.other_handle),
        avatarColor: gradientFor(item.other_profile_id || item.other_full_name),
        avatar_url:  item.other_avatar_url || null,
      },
    });
  }

  async function startThreadWith(contact) {
    if (opening) return;
    if (!checkGate()) return;
    setOpening(true);
    const { data: threadId, error } = await supabase
      .rpc('start_direct_thread', { p_other: contact.profile_id });
    setOpening(false);
    if (error) {
      toast({ title: 'Could not open chat', message: error.message, type: 'error' });
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
        avatar_url:  contact.avatar_url || null,
      },
    });
  }

  // Derive visible threads based on active tab + hide groups toggle
  const visibleThreads = threads.filter((t) => {
    const isGroup  = t.kind === 'group';
    const isChurch = t.kind === 'church';
    if (activeTab === 'groups') return isGroup;           // church never in Groups tab
    if (isChurch) {
      if (activeTab === 'new') return (t.unread_count ?? 0) > 0;
      return true;
    }
    if (hideGroups && isGroup) return false;
    if (activeTab === 'new') return (t.unread_count ?? 0) > 0;
    return true; // 'all'
  });

  const TABS = [
    { key: 'all',    label: 'All' },
    { key: 'new',    label: 'New' },
    { key: 'groups', label: 'Groups' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <ProfileGateModal />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerMeta}>Inbox</Text>
          <Wordmark size="md" label="Messages" />
        </View>
        <View style={styles.headerActions}>
          {/* Hide/show groups toggle — only relevant outside the Groups tab */}
          {activeTab !== 'groups' ? (
            <TouchableOpacity
              style={[styles.hideGroupsBtn, hideGroups && styles.hideGroupsBtnActive]}
              onPress={() => setHideGroups((v) => !v)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={hideGroups ? 'people' : 'people-outline'}
                size={14}
                color={hideGroups ? COLORS.accent : COLORS.textSecondary}
              />
              <Text style={[styles.hideGroupsText, hideGroups && styles.hideGroupsTextActive]}>
                {hideGroups ? 'Show Groups' : 'Hide Groups'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <IconButton onPress={() => setComposeOpen(true)}>
            <Ionicons name="create-outline" size={18} color={COLORS.text} />
          </IconButton>
        </View>
      </View>

      {/* Segment control — matches FOUND page Connected/Requests/Events */}
      <View style={styles.segmentWrap}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.segBtn, activeTab === tab.key && styles.segBtnActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segLabel, activeTab === tab.key && styles.segLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
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
          data={visibleThreads}
          keyExtractor={(item) => item.thread_id}
          renderItem={({ item }) => (
            <MessageRow item={item} onPress={() => openThread(item)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="chatbubbles-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>
                {activeTab === 'new' ? 'No unread messages' : activeTab === 'groups' ? 'No group chats yet' : 'No conversations yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {activeTab === 'new'
                  ? 'You\'re all caught up.'
                  : activeTab === 'groups'
                  ? 'Join a group to start chatting with members.'
                  : 'Tap the pencil icon above to start a conversation with someone you\'re connected with.'}
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
// Centered fade-in popup — lists connections + search bar.
// No slide-up backdrop. Clean, on-brand.
function ComposeModal({ visible, onClose, onPick, busy }) {
  const [contacts,  setContacts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [failed,    setFailed]    = useState(false);
  const [query,     setQuery]     = useState('');
  const searchRef = useRef(null);

  // Fade animation for the backdrop
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 280, friction: 22, useNativeDriver: true }),
      ]).start(() => searchRef.current?.focus());
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.95, duration: 130, useNativeDriver: true }),
      ]).start();
      setQuery('');
    }
  }, [visible]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const { data, error } = await supabase.rpc('messageable_contacts');
    if (error) {
      console.warn('[compose] contacts failed', error.message);
      setFailed(true);
      setContacts([]);
    } else {
      setContacts(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    loadContacts();
  }, [visible, loadContacts]);

  const filtered = query.trim().length === 0
    ? contacts
    : contacts.filter((c) => {
        const q = query.toLowerCase();
        return (
          (c.full_name  ?? '').toLowerCase().includes(q) ||
          (c.handle     ?? '').toLowerCase().includes(q)
        );
      });

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Tap-away backdrop */}
      <Animated.View style={[modalStyles.backdrop, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={() => { Keyboard.dismiss(); onClose(); }}
          activeOpacity={1}
        />

        {/* Centered card */}
        <Animated.View
          style={[
            modalStyles.card,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Header */}
          <View style={modalStyles.headerRow}>
            <Text style={modalStyles.title}>New Message</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Search bar */}
          <View style={modalStyles.searchBar}>
            <Ionicons name="search" size={16} color={COLORS.textTertiary} />
            <TextInput
              ref={searchRef}
              style={modalStyles.searchInput}
              placeholder="Search connections…"
              placeholderTextColor={COLORS.textTertiary}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Content */}
          {loading ? (
            <View style={modalStyles.centerPad}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : failed ? (
            <View style={modalStyles.centerPad}>
              <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textTertiary} />
              <Text style={modalStyles.emptyTitle}>Couldn't load contacts</Text>
              <TouchableOpacity style={modalStyles.retryBtn} onPress={loadContacts} activeOpacity={0.8}>
                <Ionicons name="refresh" size={15} color={COLORS.text} />
                <Text style={modalStyles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : filtered.length === 0 ? (
            <View style={modalStyles.centerPad}>
              <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
              <Text style={modalStyles.emptyTitle}>
                {query.trim() ? 'No matches' : 'No connections yet'}
              </Text>
              <Text style={modalStyles.emptyBody}>
                {query.trim()
                  ? 'Try a different name.'
                  : 'Connect with someone in Discover first, then come back here.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.profile_id}
              keyboardShouldPersistTaps="handled"
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
                      size={44}
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
              contentContainerStyle={{ paddingBottom: 8 }}
              style={{ maxHeight: 380 }}
            />
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    ...SHADOW.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  title: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
  },

  centerPad: { alignItems: 'center', paddingVertical: SPACING.xl, gap: 8 },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 18, color: COLORS.text, marginTop: 6 },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12,
    paddingVertical: 9, paddingHorizontal: 16,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  retryText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.text },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  rowMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary },
  matchPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.sageBg, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  matchText: { fontFamily: FONT.semiBold, fontSize: 10, color: COLORS.sage },
  sep: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 56 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.sm,
  },
  headerMeta: {
    fontFamily: FONT.mono, fontSize: 9, letterSpacing: 1.6,
    textTransform: 'uppercase', color: COLORS.textTertiary, marginBottom: 3,
  },
  headerActions: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  hideGroupsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  hideGroupsBtnActive: {
    borderColor: COLORS.accent, backgroundColor: COLORS.sageBg ?? COLORS.surface,
  },
  hideGroupsText: {
    fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.textSecondary,
  },
  hideGroupsTextActive: { color: COLORS.accent },

  // Segment control — matches FOUND page style exactly
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  segLabelActive: {
    color: COLORS.text,
  },

  title: { fontFamily: FONT.serifItalic, fontSize: 30, color: COLORS.text, letterSpacing: -0.3 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: SPACING.lg, paddingVertical: 13,
  },
  avatarWrap: { position: 'relative', flexShrink: 0 },
  churchAvatar: { width: 50, height: 50, borderRadius: RADIUS.full, overflow: 'hidden' },
  churchAvatarFallback: {
    width: 50, height: 50, borderRadius: RADIUS.full,
    backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center',
  },
  churchLabel: { fontFamily: FONT.regular, fontSize: 11, color: COLORS.textTertiary, flexShrink: 0 },
  groupAvatar: {
    width: 50, height: 50, borderRadius: RADIUS.full,
    backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1, gap: 3, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  name:          { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text, flexShrink: 1 },
  nameConnected: { fontFamily: FONT.bold,     fontSize: 15, color: COLORS.text },
  groupLabel:    { fontFamily: FONT.regular,  fontSize: 12, color: COLORS.textTertiary, flexShrink: 0 },
  preview:        { fontFamily: FONT.regular,   fontSize: 13, color: COLORS.textSecondary },
  previewUnread:  { fontFamily: FONT.semiBold,  fontSize: 13, color: COLORS.text },
  right: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  time:  { fontFamily: FONT.regular, fontSize: 11, color: COLORS.textTertiary },
  badge: {
    backgroundColor: COLORS.accent, borderRadius: RADIUS.full,
    minWidth: 20, height: 20, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: 11, fontFamily: FONT.bold },
  separator: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 78 },

  emptyWrap: {
    alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING['2xl'] ?? 48,
  },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text, marginTop: 4 },
  emptyBody: {
    fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },
});
