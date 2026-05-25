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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import GroupCard from '../components/GroupCard';
import { PrimaryButton, Chip } from '../components/Atoms';
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
            <View style={styles.header}>
              <Text style={styles.headerMeta}>Local Community</Text>
              <Text style={styles.title}>Groups</Text>
              <Text style={styles.sub}>Find your people — in real life</Text>

              <TouchableOpacity
                style={styles.createBtn}
                activeOpacity={0.8}
                onPress={() => setCreateOpen(true)}
              >
                <Ionicons name="add" size={15} color={COLORS.text} />
                <Text style={styles.createBtnText}>Create a Group</Text>
              </TouchableOpacity>

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
              <View style={styles.filterRow}>
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
              </View>
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
        onCreated={() => { setCreateOpen(false); load({ isRefresh: true }); }}
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
    onCreated?.();
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

  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.md,
  },
  headerMeta: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 4,
  },
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 36,
  },
  sub: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 0,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
  },

  // Search bar
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    height: 40,
    gap: 8,
  },
  searchIcon: {
    marginTop: 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    flexWrap: 'wrap',
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

  // Cover photo picker
  coverEmpty: {
    height: 132,
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
    height: 132,
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
