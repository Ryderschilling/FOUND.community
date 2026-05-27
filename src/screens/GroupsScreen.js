// ─────────────────────────────────────────────────────────────────────────
// GroupsScreen
//
// Real data via my_groups_feed() RPC (joined + suggested in one call).
// Tap "Join Group" → join_group RPC. Tap "Joined" → confirm + leave.
// Create button opens a modal that calls create_group RPC.
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  StatusBar,
  SafeAreaView,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Image,
  KeyboardAvoidingView,
  Share,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import GroupCard from '../components/GroupCard';
import { PrimaryButton, Chip, Wordmark, IconButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { geocode } from '../lib/geocode';
import { firstViolation } from '../lib/contentFilter';
import {
  publicUrlForGroupPhoto,
  pickGroupImage,
  uploadGroupPhoto,
} from '../lib/groupPhotos';
import { useConfirm } from '../components/ConfirmProvider';

// RPC row → GroupCard shape
function rowToGroup(row) {
  return {
    id:          row.id,
    name:        row.name,
    description: row.description,
    icon:        row.icon,
    iconColor:   row.icon_color,
    iconBg:      row.icon_bg,
    memberCount: row.member_count,
    meetingDay:  row.schedule_text,
    joined:      !!row.is_member,
    createdBy:   row.created_by,
    coverUrl:    row.cover_path ? publicUrlForGroupPhoto(row.cover_path) : null,
    isPublic:    !!row.is_public,
    hasPendingRequest: !!row.has_pending_request,
  };
}

export default function GroupsScreen({ navigation }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId]         = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  // After a successful create_group, we stash the new group here so the
  // post-create congrats modal can present invite/share actions.
  const [postCreateGroup, setPostCreateGroup] = useState(null); // { id, name } | null
  const [searchText, setSearchText]  = useState('');
  const [filterType, setFilterType]  = useState('all'); // 'all' | 'joined' | 'public' | 'private'

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { data, error } = await supabase.rpc('my_groups_feed');
      if (error) throw error;
      setGroups((data ?? []).map(rowToGroup));
    } catch (e) {
      console.warn('[groups] load failed', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh when focused (e.g. after creating a group)
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => load({ isRefresh: true }));
    return unsub;
  }, [navigation, load]);

  // Optimistic join: public groups join instantly, private groups file a request
  const handleJoin = useCallback(async (group) => {
    if (busyId) return;
    setBusyId(group.id);

    // Optimistically update based on group privacy
    if (group.isPublic) {
      setGroups((prev) => prev.map((g) =>
        g.id === group.id ? { ...g, joined: true, memberCount: (g.memberCount ?? 0) + 1 } : g));
    } else {
      setGroups((prev) => prev.map((g) =>
        g.id === group.id ? { ...g, hasPendingRequest: true } : g));
    }

    const { error } = await supabase.rpc('join_group', { p_group: group.id });
    setBusyId(null);

    if (error) {
      console.warn('[groups] join failed', error.message);
      setGroups((prev) => prev.map((g) =>
        g.id === group.id
          ? { ...g, joined: false, hasPendingRequest: false, memberCount: Math.max(0, (g.memberCount ?? 1) - 1) }
          : g));
      Alert.alert('Could not join', error.message);
      return;
    }

    // Reconcile with server truth. The optimistic update above already gave
    // instant feedback; refetching the feed replaces every count with the
    // live value from my_groups_feed() — no fragile client-side arithmetic,
    // and it picks up the correct joined/pending state for both public and
    // private groups.
    load({ isRefresh: true });
  }, [busyId, load]);

  // Confirm + optimistic leave
  const handleLeave = useCallback(async (group) => {
    const ok = await confirm({
      title: 'Leave group?',
      message: `You'll stop seeing posts and messages from "${group.name}".`,
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    if (busyId) return;
    setBusyId(group.id);
    setGroups((prev) => prev.map((g) =>
      g.id === group.id ? { ...g, joined: false, memberCount: Math.max(0, (g.memberCount ?? 1) - 1) } : g));
    const { error } = await supabase.rpc('leave_group', { p_group: group.id });
    setBusyId(null);
    if (error) {
      console.warn('[groups] leave failed', error.message);
      setGroups((prev) => prev.map((g) =>
        g.id === group.id ? { ...g, joined: true, memberCount: (g.memberCount ?? 0) + 1 } : g));
      // Surface the error in-app — Alert.alert is unreliable on web.
      const ownerBlocked = /owner cannot leave/i.test(error.message || '');
      await confirm({
        title: ownerBlocked ? 'You own this group' : 'Could not leave',
        message: ownerBlocked
          ? 'Owners can’t leave their own group. Open it and use the settings gear to delete it or transfer ownership.'
          : error.message,
        confirmLabel: 'OK',
        cancelLabel: 'OK',
      });
    }
  }, [busyId, confirm]);

  // Cancel a pending join request
  const handleCancelRequest = useCallback(async (group) => {
    if (busyId) return;
    setBusyId(group.id);
    setGroups((prev) => prev.map((g) =>
      g.id === group.id ? { ...g, hasPendingRequest: false } : g));
    const { error } = await supabase.rpc('cancel_join_request', { p_group: group.id });
    setBusyId(null);
    if (error) {
      console.warn('[groups] cancel request failed', error.message);
      setGroups((prev) => prev.map((g) =>
        g.id === group.id ? { ...g, hasPendingRequest: true } : g));
      Alert.alert('Could not cancel request', error.message);
    }
  }, [busyId]);

  // Search and filter groups
  const filteredGroups = useMemo(() => {
    let result = groups;

    // Filter by type
    if (filterType === 'joined') {
      result = result.filter((g) => g.joined);
    } else if (filterType === 'public') {
      result = result.filter((g) => g.isPublic);
    } else if (filterType === 'private') {
      result = result.filter((g) => !g.isPublic);
    }

    // Search by name, description, city (case-insensitive)
    if (searchText.trim()) {
      const query = searchText.trim().toLowerCase();
      result = result.filter((g) => {
        const name = (g.name ?? '').toLowerCase();
        const desc = (g.description ?? '').toLowerCase();
        const city = (g.city ?? '').toLowerCase();
        return name.includes(query) || desc.includes(query) || city.includes(query);
      });
    }

    return result;
  }, [groups, searchText, filterType]);

  // Split filtered groups into sections
  const sections = useMemo(() => {
    // If "Joined" filter is active, don't split sections
    if (filterType === 'joined') {
      return filteredGroups.length > 0 ? [{ title: 'JOINED', data: filteredGroups }] : [];
    }

    const joined = filteredGroups.filter((g) => g.joined);
    const suggested = filteredGroups.filter((g) => !g.joined);
    const out = [];
    if (joined.length) out.push({ title: 'JOINED', data: joined });
    if (suggested.length) out.push({ title: 'SUGGESTED FOR YOU', data: suggested });
    return out;
  }, [filteredGroups, filterType]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Fixed page header — matches all other tab screens */}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.headerMeta}>Local Community</Text>
          <Wordmark size="md" label="Groups" />
        </View>
        <TouchableOpacity
          style={styles.createIconBtn}
          activeOpacity={0.85}
          onPress={() => setCreateOpen(true)}
          accessibilityLabel="Create a group"
        >
          <Ionicons name="add" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <GroupCard
                group={item}
                currentUserId={user?.id}
                onJoin={() => handleJoin(item)}
                onLeave={() => handleLeave(item)}
                onCancelRequest={() => handleCancelRequest(item)}
                busy={busyId === item.id}
                onPress={() => navigation.navigate('GroupDetail', { groupId: item.id, group: item })}
              />
            </View>
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderWrap}>
              <Text style={styles.sectionLabel}>{section.title}</Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.listSubHeader}>
              {/* Search bar */}
              <View style={styles.searchWrap}>
                <Ionicons
                  name="search"
                  size={16}
                  color={COLORS.textTertiary}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search groups by name, city..."
                  placeholderTextColor={COLORS.textTertiary}
                  value={searchText}
                  onChangeText={setSearchText}
                />
              </View>

              {/* Filter chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                <Chip
                  label="All"
                  active={filterType === 'all'}
                  onPress={() => setFilterType('all')}
                />
                <Chip
                  label="Joined"
                  active={filterType === 'joined'}
                  onPress={() => setFilterType('joined')}
                />
                <Chip
                  label="Public"
                  active={filterType === 'public'}
                  onPress={() => setFilterType('public')}
                />
                <Chip
                  label="Private"
                  active={filterType === 'private'}
                  onPress={() => setFilterType('private')}
                />
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptyBody}>Be first — create one for your area.</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load({ isRefresh: true })}
              tintColor={COLORS.textTertiary}
            />
          }
        />
      )}

      <CreateGroupModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          setCreateOpen(false);
          load({ isRefresh: true });
          if (created?.id) setPostCreateGroup(created);
        }}
      />

      <PostCreateGroupModal
        group={postCreateGroup}
        onClose={() => setPostCreateGroup(null)}
      />
    </SafeAreaView>
  );
}

// ─── Create Group modal ───────────────────────────────────────────────────
function CreateGroupModal({ visible, onClose, onCreated }) {
  const [name, setName]         = useState('');
  const [desc, setDesc]         = useState('');
  const [city, setCity]         = useState('');
  const [state, setState]       = useState('');
  const [address, setAddress]   = useState('');
  const [schedule, setSchedule] = useState('');
  const [cover, setCover]       = useState(null);   // { uri, base64 } picked, not yet uploaded
  const [isPublic, setIsPublic] = useState(true);   // Public by default
  const [busy, setBusy]         = useState(false);

  const reset = () => {
    setName(''); setDesc(''); setCity(''); setState('');
    setAddress(''); setSchedule(''); setCover(null);
    setIsPublic(true);
  };

  async function handlePickCover() {
    if (busy) return;
    const { picked, error } = await pickGroupImage('library');
    if (error) { Alert.alert('Could not add photo', error.message); return; }
    if (picked) setCover(picked); // null = user cancelled
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your group a name.');
      return;
    }

    const violation = firstViolation([
      { text: name, label: 'group name' },
      { text: desc, label: 'group description' },
    ]);
    if (!violation.ok) {
      Alert.alert('Check your wording', violation.message);
      return;
    }

    setBusy(true);

    // Geocode city/state so the group can be distance-sorted/filtered.
    // Non-fatal: if geocoding fails the group is still created without a
    // location (lat/lng null → create_group leaves `location` NULL).
    let lat = null;
    let lng = null;
    const loc = [city.trim(), state.trim()].filter(Boolean).join(', ');
    if (loc) {
      try {
        const g = await geocode(loc);
        if (!g.error && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
          lat = g.lat;
          lng = g.lng;
        }
      } catch {
        // ignore — group still gets created without coords
      }
    }

    const { data: newId, error } = await supabase.rpc('create_group', {
      p_name:          name,
      p_description:   desc,
      p_city:          city,
      p_state:         state,
      p_address:       address,
      p_schedule_text: schedule,
      p_lat:           lat,
      p_lng:           lng,
    });
    if (error) {
      setBusy(false);
      Alert.alert('Could not create group', error.message);
      return;
    }

    // If the group is private, set privacy after creation.
    // create_group always creates public groups, so we need to flip the flag.
    if (newId && !isPublic) {
      const { error: privErr } = await supabase.rpc('set_group_privacy', {
        p_group: newId,
        p_is_public: false,
      });
      if (privErr) {
        console.warn('[create group] set privacy failed', privErr.message);
        Alert.alert('Warning', 'Group created but privacy setting failed. You can change it from the group page.');
      }
    }

    // Upload the cover photo now that the group (and its id) exists.
    // Non-fatal: the group is already created — a failed photo just means
    // the owner can re-add it from the group page.
    if (cover && newId) {
      const { error: upErr } = await uploadGroupPhoto(newId, cover);
      if (upErr) console.warn('[create group] cover upload failed', upErr.message);
    }

    setBusy(false);
    reset();
    onCreated?.({ id: newId, name });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.headerRow}>
            <Text style={modalStyles.title}>Create a Group</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Cover photo */}
            <View style={modalStyles.field}>
              <Text style={modalStyles.fieldLabel}>Cover Photo</Text>
              {cover ? (
                <View style={modalStyles.coverWrap}>
                  <Image source={{ uri: cover.uri }} style={modalStyles.coverImage} />
                  <TouchableOpacity
                    style={modalStyles.coverRemove}
                    onPress={() => setCover(null)}
                    hitSlop={8}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close" size={14} color={COLORS.white} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={modalStyles.coverReplace}
                    onPress={handlePickCover}
                    activeOpacity={0.8}
                  >
                    <Text style={modalStyles.coverReplaceText}>Replace</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={modalStyles.coverEmpty}
                  onPress={handlePickCover}
                  activeOpacity={0.8}
                >
                  <Ionicons name="image-outline" size={22} color={COLORS.textTertiary} />
                  <Text style={modalStyles.coverEmptyText}>Add a cover photo</Text>
                </TouchableOpacity>
              )}
            </View>

            <Field label="Name *" value={name} onChange={setName} placeholder="e.g. Tuesday Night Bible Study" />
            <Field
              label="Description"
              value={desc}
              onChange={setDesc}
              placeholder="What you do, who it's for, how often"
              multiline
            />
            <Field label="City"     value={city}     onChange={setCity}     placeholder="Santa Rosa Beach" />
            <Field label="State"    value={state}    onChange={setState}    placeholder="FL" />
            <Field
              label="Meeting Address"
              value={address}
              onChange={setAddress}
              placeholder="Street address — shown to members only"
            />
            <Field label="Schedule" value={schedule} onChange={setSchedule} placeholder="Tuesdays 7pm" />

            {/* Privacy toggle */}
            <View style={modalStyles.field}>
              <Text style={modalStyles.fieldLabel}>Group Privacy</Text>
              <View style={modalStyles.privacyRow}>
                <TouchableOpacity
                  style={[modalStyles.privacyOption, isPublic && modalStyles.privacyOptionActive]}
                  onPress={() => setIsPublic(true)}
                  activeOpacity={0.7}
                >
                  <Text style={[modalStyles.privacyText, isPublic && modalStyles.privacyTextActive]}>
                    Public
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[modalStyles.privacyOption, !isPublic && modalStyles.privacyOptionActive]}
                  onPress={() => setIsPublic(false)}
                  activeOpacity={0.7}
                >
                  <Text style={[modalStyles.privacyText, !isPublic && modalStyles.privacyTextActive]}>
                    Private
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={modalStyles.privacyHelper}>
                {isPublic
                  ? 'Anyone can join'
                  : 'You approve join requests'}
              </Text>
            </View>
          </ScrollView>

          <PrimaryButton
            label={busy ? 'Creating…' : 'Create Group'}
            onPress={handleCreate}
            disabled={busy}
            loading={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChange, placeholder, multiline }) {
  return (
    <View style={modalStyles.field}>
      <Text style={modalStyles.fieldLabel}>{label}</Text>
      <TextInput
        style={[modalStyles.input, multiline && modalStyles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textTertiary}
        multiline={multiline}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 110 },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
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
  listSubHeader: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    gap: SPACING.md,
  },
  createIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search bar — bigger, more presence
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    height: 46,
    gap: 10,
  },
  searchIcon: {
    marginTop: 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  // Filter chips — horizontal scroll, tight gap
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingRight: SPACING.lg, // breathing room at scroll end
  },

  sectionHeaderWrap: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
  },

  cardWrap: {
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 20, color: COLORS.text, marginTop: 4 },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    // Center the sheet horizontally. On web the Modal portals to the document
    // root (outside the phone-width frame in App.js), so without this the sheet
    // stretches the full browser width. Centering + maxWidth keeps it inside
    // the phone column. No-op on native (the app already fills the screen).
    alignItems: 'center',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '85%',
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 430 : undefined,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  title: { fontFamily: FONT.serifItalic, fontSize: 24, color: COLORS.text },

  field: { marginBottom: SPACING.md },
  fieldLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    // Kill the default browser focus ring on web — the box already has a border.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },

  // Cover photo picker — square, matches the GroupDetail hero
  coverEmpty: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  coverEmptyText: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  coverWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  coverImage: { width: '100%', height: '100%' },
  coverRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverReplace: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  coverReplaceText: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.white,
  },

  // Privacy toggle
  privacyRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  privacyOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  privacyOptionActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  privacyText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  privacyTextActive: {
    color: COLORS.white,
  },
  privacyHelper: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 8,
  },
});

// ─── Post-create Congrats modal ───────────────────────────────────────────
// Shows immediately after a successful create_group. Offers two paths:
//   (1) Invite Connections  — picks from my_connections, fires in-app invites
//   (2) Share Beyond FOUND  — native share sheet with a deep link
// "Maybe Later" closes without doing anything.
function PostCreateGroupModal({ group, onClose }) {
  const [inviteOpen, setInviteOpen] = useState(false);

  if (!group) return null;

  // Shares the FOUND website. Group-specific landing page is a follow-up.
  const shareUrl = 'https://found.community';

  async function handleShare() {
    try {
      await Share.share({
        title: `Join "${group.name}" on FOUND`,
        message: `I just started a group on FOUND — check it out: ${shareUrl}`,
        url: shareUrl, // iOS uses url, Android uses message
      });
    } catch (e) {
      // User cancelling the share sheet throws — silent.
    }
  }

  return (
    <>
      <Modal visible={!!group} transparent animationType="fade" onRequestClose={onClose}>
        <View style={postCreateStyles.backdrop}>
          <View style={postCreateStyles.sheet}>
            <View style={postCreateStyles.celebrateIconWrap}>
              <Ionicons name="checkmark-circle" size={44} color={COLORS.text} />
            </View>

            <Text style={postCreateStyles.title}>You created a group.</Text>
            <Text style={postCreateStyles.subtitle}>
              "{group.name}" is live. Bring people in.
            </Text>

            <TouchableOpacity
              style={postCreateStyles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => setInviteOpen(true)}
            >
              <Ionicons name="people-outline" size={18} color={COLORS.white} />
              <Text style={postCreateStyles.primaryText}>Invite Connections</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={postCreateStyles.secondaryBtn}
              activeOpacity={0.85}
              onPress={handleShare}
            >
              <Ionicons name="share-outline" size={18} color={COLORS.text} />
              <Text style={postCreateStyles.secondaryText}>Share Beyond FOUND</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={postCreateStyles.linkBtn}
              activeOpacity={0.7}
              onPress={onClose}
            >
              <Text style={postCreateStyles.linkText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <InviteConnectionsModal
        visible={inviteOpen}
        group={group}
        onClose={() => setInviteOpen(false)}
        onSent={() => {
          setInviteOpen(false);
          onClose(); // close the post-create flow once invites fire
        }}
      />
    </>
  );
}

const postCreateStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  celebrateIconWrap: {
    alignSelf: 'center',
    marginBottom: SPACING.sm,
  },
  title: {
    fontFamily: FONT.serif || FONT.semiBold,
    fontSize: 24,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.text,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    marginBottom: 10,
  },
  primaryText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.white,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
  },
  linkBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  linkText: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
});

// ─── Invite Connections picker ────────────────────────────────────────────
function InviteConnectionsModal({ visible, group, onClose, onSent }) {
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [conns, setConns]       = useState([]);
  const [selected, setSelected] = useState({}); // { [profile_id]: true }
  const [search, setSearch]     = useState('');

  useEffect(() => {
    if (!visible) {
      setSelected({});
      setSearch('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('my_connections');
      if (cancelled) return;
      if (error) {
        console.warn('[invite] my_connections failed', error.message);
        setConns([]);
      } else {
        setConns(data ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conns;
    return conns.filter((c) =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.handle    || '').toLowerCase().includes(q)
    );
  }, [conns, search]);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  function toggle(id) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function handleSend() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) {
      Alert.alert('Pick someone', 'Select at least one connection to invite.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('invite_to_group', {
      p_group:    group.id,
      p_invitees: ids,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Could not send invites', error.message);
      return;
    }
    Alert.alert(
      'Invites sent',
      `${data ?? ids.length} ${(data ?? ids.length) === 1 ? 'invite' : 'invites'} sent.`
    );
    onSent?.();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={inviteStyles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={inviteStyles.sheet}>
          <View style={inviteStyles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={inviteStyles.headerTitle}>Invite to {group?.name}</Text>
            <View style={{ width: 22 }} />
          </View>

          <TextInput
            style={inviteStyles.search}
            placeholder="Search connections"
            placeholderTextColor={COLORS.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />

          {loading ? (
            <View style={inviteStyles.center}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={inviteStyles.center}>
              <Text style={inviteStyles.emptyText}>
                {conns.length === 0
                  ? "You don't have any connections yet. Use Share Beyond FOUND instead."
                  : 'No connections match that search.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.profile_id}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: SPACING.lg }}
              renderItem={({ item }) => {
                const isOn = !!selected[item.profile_id];
                return (
                  <TouchableOpacity
                    style={inviteStyles.row}
                    activeOpacity={0.8}
                    onPress={() => toggle(item.profile_id)}
                  >
                    <View style={inviteStyles.avatar}>
                      {item.avatar_url ? (
                        <Image source={{ uri: item.avatar_url }} style={inviteStyles.avatarImg} />
                      ) : (
                        <Text style={inviteStyles.avatarInit}>
                          {(item.full_name || item.handle || '?').slice(0, 1).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={inviteStyles.name}>{item.full_name || item.handle}</Text>
                      {item.life_stage_label ? (
                        <Text style={inviteStyles.sub}>{item.life_stage_label}</Text>
                      ) : null}
                    </View>
                    <View style={[inviteStyles.check, isOn && inviteStyles.checkOn]}>
                      {isOn ? <Ionicons name="checkmark" size={14} color={COLORS.white} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <PrimaryButton
            label={busy
              ? 'Sending…'
              : selectedCount
                ? `Send ${selectedCount} ${selectedCount === 1 ? 'invite' : 'invites'}`
                : 'Send invites'}
            onPress={handleSend}
            disabled={busy || selectedCount === 0}
            loading={busy}
            style={{ marginTop: SPACING.sm }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const inviteStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    maxHeight: '85%',
    minHeight: '60%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  headerTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 16,
    color: COLORS.text,
    flex: 1,
    textAlign: 'center',
  },
  search: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyText: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInit: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  name: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  sub: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
});
