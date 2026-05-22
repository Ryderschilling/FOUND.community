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
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import GroupCard from '../components/GroupCard';
import { PrimaryButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { geocode } from '../lib/geocode';
import { publicUrlForGroupPhoto } from '../lib/groupPhotos';
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

  // Optimistic join
  const handleJoin = useCallback(async (group) => {
    if (busyId) return;
    setBusyId(group.id);
    setGroups((prev) => prev.map((g) =>
      g.id === group.id ? { ...g, joined: true, memberCount: (g.memberCount ?? 0) + 1 } : g));
    const { error } = await supabase.rpc('join_group', { p_group: group.id });
    setBusyId(null);
    if (error) {
      console.warn('[groups] join failed', error.message);
      setGroups((prev) => prev.map((g) =>
        g.id === group.id ? { ...g, joined: false, memberCount: Math.max(0, (g.memberCount ?? 1) - 1) } : g));
      Alert.alert('Could not join', error.message);
    }
  }, [busyId]);

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
      Alert.alert('Could not leave', error.message);
    }
  }, [busyId, confirm]);

  // Split into sections
  const sections = useMemo(() => {
    const joined = groups.filter((g) => g.joined);
    const suggested = groups.filter((g) => !g.joined);
    const out = [];
    if (joined.length)    out.push({ title: 'JOINED',             data: joined });
    if (suggested.length) out.push({ title: 'SUGGESTED FOR YOU',  data: suggested });
    return out;
  }, [groups]);

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
                onJoin={() => handleJoin(item)}
                onLeave={() => handleLeave(item)}
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
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy]         = useState(false);

  const reset = () => {
    setName(''); setDesc(''); setCity(''); setState(''); setSchedule('');
  };

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your group a name.');
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

    const { error } = await supabase.rpc('create_group', {
      p_name:          name,
      p_description:   desc,
      p_city:          city,
      p_state:         state,
      p_schedule_text: schedule,
      p_lat:           lat,
      p_lng:           lng,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Could not create group', error.message);
      return;
    }
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
            <Field label="Schedule" value={schedule} onChange={setSchedule} placeholder="Tuesdays 7pm" />
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
    marginBottom: SPACING.md,
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
    ...SHADOW.sm,
  },
  createBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
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
    marginBottom: 10,
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
});
