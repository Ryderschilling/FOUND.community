// ─────────────────────────────────────────────────────────────────────────
// GroupDetailScreen
//
// Full group page: cover, info, photo gallery, member roster, and the
// join / leave / open-chat actions. Owners and admins also get inline
// management — edit group, add/remove photos, manage members, delete group.
//
// Route params: { groupId, group? }  (group is an optional preview row from
// the Groups feed so the header can render instantly before the RPCs return).
//
// Data:
//   group_detail()        → header + caller's membership state / role
//   group_members_list()  → roster
//   fetchGroupPhotos()    → gallery
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, PrimaryButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { geocode } from '../lib/geocode';
import {
  fetchGroupPhotos,
  pickAndUploadGroupPhoto,
  deleteGroupPhoto,
  purgeGroupPhotoStorage,
  publicUrlForGroupPhoto,
  MAX_GROUP_PHOTOS,
} from '../lib/groupPhotos';

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

// ─── Screen ───────────────────────────────────────────────────────────────
export default function GroupDetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const groupId = route?.params?.groupId ?? route?.params?.group?.id ?? null;
  const preview = route?.params?.group ?? null;

  const [detail, setDetail]     = useState(null);
  const [members, setMembers]   = useState([]);
  const [photos, setPhotos]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [busy, setBusy]               = useState(false); // join / leave
  const [openingChat, setOpeningChat] = useState(false);
  const [uploading, setUploading]     = useState(false);

  const [editOpen, setEditOpen]         = useState(false);
  const [manageTarget, setManageTarget] = useState(null); // member row
  const [lightbox, setLightbox]         = useState(null);

  const isOwner  = detail?.my_role === 'owner';
  const isAdmin  = isOwner || detail?.my_role === 'admin';
  const isMember = !!detail?.is_member;

  const name        = detail?.name        ?? preview?.name        ?? 'Group';
  const icon        = detail?.icon        ?? preview?.icon        ?? 'people-outline';
  const iconColor   = detail?.icon_color  ?? preview?.iconColor   ?? COLORS.sage;
  const iconBg      = detail?.icon_bg     ?? preview?.iconBg      ?? COLORS.sageBg;
  const memberCount = detail?.member_count ?? preview?.memberCount ?? 0;
  const coverUrl    = detail?.cover_path ? publicUrlForGroupPhoto(detail.cover_path) : null;

  // ── Loaders ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async ({ isRefresh } = {}) => {
    if (!groupId) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [dRes, mRes, pRes] = await Promise.all([
        supabase.rpc('group_detail', { p_group: groupId }),
        supabase.rpc('group_members_list', { p_group: groupId }),
        fetchGroupPhotos(groupId),
      ]);
      if (dRes.error) console.warn('[group] detail failed', dRes.error.message);
      else setDetail((dRes.data ?? [])[0] ?? null);
      if (mRes.error) console.warn('[group] members failed', mRes.error.message);
      else setMembers(mRes.data ?? []);
      if (pRes.error) console.warn('[group] photos failed', pRes.error.message);
      else setPhotos(pRes.photos ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshDetail = useCallback(async () => {
    const { data } = await supabase.rpc('group_detail', { p_group: groupId });
    setDetail((data ?? [])[0] ?? null);
  }, [groupId]);

  const refreshMembers = useCallback(async () => {
    const { data } = await supabase.rpc('group_members_list', { p_group: groupId });
    setMembers(data ?? []);
  }, [groupId]);

  const refreshPhotos = useCallback(async () => {
    const { photos: p } = await fetchGroupPhotos(groupId);
    setPhotos(p ?? []);
  }, [groupId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleJoin() {
    if (busy || !groupId) return;
    setBusy(true);
    const { error } = await supabase.rpc('join_group', { p_group: groupId });
    setBusy(false);
    if (error) { Alert.alert('Could not join', error.message); return; }
    await Promise.all([refreshDetail(), refreshMembers()]);
  }

  async function handleLeave() {
    const ok = await confirm({
      title: 'Leave group?',
      message: `You'll stop seeing posts and messages from "${name}".`,
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    if (busy || !groupId) return;
    setBusy(true);
    const { error } = await supabase.rpc('leave_group', { p_group: groupId });
    setBusy(false);
    if (error) { Alert.alert('Could not leave', error.message); return; }
    await Promise.all([refreshDetail(), refreshMembers()]);
  }

  async function handleOpenChat() {
    if (openingChat || !groupId) return;
    setOpeningChat(true);
    const { data: threadId, error } = await supabase.rpc('open_group_thread', { p_group: groupId });
    setOpeningChat(false);
    if (error) { Alert.alert('Could not open chat', error.message); return; }
    navigation.navigate('Chat', {
      thread_id: threadId,
      isGroup: true,
      group: {
        id: groupId,
        name,
        icon,
        iconColor,
        iconBg,
        memberCount,
      },
    });
  }

  async function handleAddPhoto() {
    if (uploading || !groupId) return;
    if (photos.length >= MAX_GROUP_PHOTOS) {
      Alert.alert('Photo limit reached', `Groups can have up to ${MAX_GROUP_PHOTOS} photos.`);
      return;
    }
    setUploading(true);
    const { photo, error } = await pickAndUploadGroupPhoto({ groupId, source: 'library' });
    setUploading(false);
    if (error) { Alert.alert('Upload failed', error.message); return; }
    if (photo) await refreshPhotos();
  }

  async function handleDeletePhoto(photo) {
    const ok = await confirm({
      title: 'Delete photo?',
      message: 'This removes it from the group gallery.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await deleteGroupPhoto(photo.id, photo.storage_path);
    if (error) { Alert.alert('Could not delete', error.message); return; }
    await refreshPhotos();
  }

  async function handleDeleteGroup() {
    const ok = await confirm({
      title: 'Delete this group?',
      message: `"${name}" and its chat, photos, and membership will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete group',
      destructive: true,
    });
    if (!ok) return;
    // Clear storage objects first — delete_group only clears DB rows.
    await purgeGroupPhotoStorage(groupId);
    const { error } = await supabase.rpc('delete_group', { p_group: groupId });
    if (error) { Alert.alert('Could not delete group', error.message); return; }
    setEditOpen(false);
    navigation.goBack();
  }

  // Member management
  async function handleSetRole(profileId, nextRole) {
    const { error } = await supabase.rpc('set_group_member_role', {
      p_group: groupId, p_profile: profileId, p_role: nextRole,
    });
    if (error) { Alert.alert('Could not update role', error.message); return; }
    setManageTarget(null);
    await refreshMembers();
  }

  async function handleRemoveMember(member) {
    const ok = await confirm({
      title: 'Remove member?',
      message: `${member.full_name || 'This person'} will be removed from "${name}".`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('remove_group_member', {
      p_group: groupId, p_profile: member.profile_id,
    });
    if (error) { Alert.alert('Could not remove', error.message); return; }
    setManageTarget(null);
    await Promise.all([refreshMembers(), refreshDetail()]);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}><ActivityIndicator color={COLORS.textTertiary} /></View>
      </SafeAreaView>
    );
  }

  if (!detail && !preview) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>Group not found</Text>
          <Text style={styles.emptyBody}>It may have been deleted.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        {isAdmin ? (
          <TouchableOpacity onPress={() => setEditOpen(true)} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={17} color={COLORS.text} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAll({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      >
        {/* Cover / hero */}
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.cover} />
        ) : (
          <View style={[styles.coverFallback, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={52} color={iconColor} />
          </View>
        )}

        <View style={styles.content}>
          <Text style={styles.name}>{name}</Text>

          {/* Meta row */}
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={13} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </Text>
            {detail?.schedule_text ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
                <Text style={styles.metaText}>{detail.schedule_text}</Text>
              </>
            ) : null}
          </View>

          {(detail?.city || detail?.state) ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>
                {[detail?.city, detail?.state].filter(Boolean).join(', ')}
              </Text>
            </View>
          ) : null}

          {detail?.description ? (
            <Text style={styles.description}>{detail.description}</Text>
          ) : null}

          {/* Photo gallery */}
          {(photos.length > 0 || isAdmin) ? (
            <View style={styles.section}>
              <View style={styles.sectionHeadRow}>
                <Text style={styles.sectionLabel}>PHOTOS</Text>
                {isAdmin && photos.length > 0 && photos.length < MAX_GROUP_PHOTOS ? (
                  <TouchableOpacity onPress={handleAddPhoto} disabled={uploading} activeOpacity={0.7}>
                    <Text style={styles.sectionAction}>{uploading ? 'Adding…' : '+ Add'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {photos.length === 0 && isAdmin ? (
                <TouchableOpacity
                  style={styles.photoEmpty}
                  onPress={handleAddPhoto}
                  disabled={uploading}
                  activeOpacity={0.8}
                >
                  {uploading ? (
                    <ActivityIndicator color={COLORS.textTertiary} />
                  ) : (
                    <>
                      <Ionicons name="image-outline" size={22} color={COLORS.textTertiary} />
                      <Text style={styles.photoEmptyText}>Add the first photo</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.galleryRow}
                >
                  {photos.map((p) => (
                    <View key={p.id} style={styles.photoTileWrap}>
                      <TouchableOpacity activeOpacity={0.9} onPress={() => setLightbox(p)}>
                        <Image source={{ uri: p.url }} style={styles.photoTile} />
                      </TouchableOpacity>
                      {isAdmin ? (
                        <TouchableOpacity
                          style={styles.photoDelete}
                          onPress={() => handleDeletePhoto(p)}
                          hitSlop={8}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close" size={13} color={COLORS.white} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ))}
                  {isAdmin && photos.length < MAX_GROUP_PHOTOS ? (
                    <TouchableOpacity
                      style={styles.photoAddTile}
                      onPress={handleAddPhoto}
                      disabled={uploading}
                      activeOpacity={0.8}
                    >
                      {uploading ? (
                        <ActivityIndicator color={COLORS.textTertiary} />
                      ) : (
                        <Ionicons name="add" size={26} color={COLORS.textTertiary} />
                      )}
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
              )}
            </View>
          ) : null}

          {/* Members */}
          <View style={styles.section}>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionLabel}>MEMBERS · {members.length}</Text>
            </View>
            <View style={styles.memberList}>
              {members.map((m) => {
                const canManage =
                  isAdmin && m.profile_id !== user?.id && m.role !== 'owner';
                return (
                  <View key={m.profile_id} style={styles.memberRow}>
                    <Avatar
                      uri={m.avatar_url || undefined}
                      initials={initialsFor(m.full_name)}
                      size={40}
                      gradientColors={gradientFor(m.profile_id)}
                    />
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.full_name || 'Member'}
                        {m.profile_id === user?.id ? '  (you)' : ''}
                      </Text>
                      {m.handle ? (
                        <Text style={styles.memberHandle} numberOfLines={1}>@{m.handle}</Text>
                      ) : null}
                    </View>
                    {m.role !== 'member' ? (
                      <View style={[
                        styles.roleBadge,
                        m.role === 'owner' ? styles.roleBadgeOwner : styles.roleBadgeAdmin,
                      ]}>
                        <Text style={[
                          styles.roleBadgeText,
                          m.role === 'owner' ? styles.roleBadgeTextOwner : styles.roleBadgeTextAdmin,
                        ]}>
                          {m.role}
                        </Text>
                      </View>
                    ) : null}
                    {canManage ? (
                      <TouchableOpacity
                        onPress={() => setManageTarget(m)}
                        hitSlop={8}
                        style={styles.manageBtn}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={styles.ctaBar}>
        {!isMember ? (
          <PrimaryButton
            label={busy ? 'Joining…' : 'Join Group'}
            onPress={handleJoin}
            disabled={busy}
            loading={busy}
            style={{ flex: 1 }}
          />
        ) : (
          <>
            {!isOwner ? (
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={handleLeave}
                disabled={busy}
                activeOpacity={0.8}
              >
                <Ionicons name="exit-outline" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.chatBtn}
              onPress={handleOpenChat}
              disabled={openingChat}
              activeOpacity={0.85}
            >
              {openingChat ? (
                <ActivityIndicator color={COLORS.white} size="small" />
              ) : (
                <>
                  <Ionicons name="chatbubble-outline" size={17} color={COLORS.white} />
                  <Text style={styles.chatBtnText}>Open Group Chat</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Lightbox */}
      <PhotoLightbox photo={lightbox} onClose={() => setLightbox(null)} />

      {/* Manage member sheet */}
      <ManageMemberModal
        member={manageTarget}
        isOwner={isOwner}
        onClose={() => setManageTarget(null)}
        onSetRole={handleSetRole}
        onRemove={handleRemoveMember}
      />

      {/* Edit group sheet */}
      <EditGroupModal
        visible={editOpen}
        detail={detail}
        isOwner={isOwner}
        onClose={() => setEditOpen(false)}
        onSaved={async () => { setEditOpen(false); await refreshDetail(); }}
        onDelete={handleDeleteGroup}
      />
    </SafeAreaView>
  );
}

// ─── Photo lightbox ───────────────────────────────────────────────────────
function PhotoLightbox({ photo, onClose }) {
  const { width, height } = Dimensions.get('window');
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lightboxRoot}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
        {photo ? (
          <Image
            source={{ uri: photo.url }}
            style={{ width: width * 0.95, height: height * 0.8 }}
            resizeMode="contain"
          />
        ) : null}
        <TouchableOpacity style={styles.lightboxClose} activeOpacity={0.8} onPress={onClose}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Manage member modal ──────────────────────────────────────────────────
function ManageMemberModal({ member, isOwner, onClose, onSetRole, onRemove }) {
  if (!member) return null;
  const isAdminRole = member.role === 'admin';
  return (
    <Modal visible={!!member} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <Text style={modalStyles.title}>{member.full_name || 'Member'}</Text>
          <Text style={modalStyles.subtitle}>
            {isAdminRole ? 'Admin' : 'Member'}
          </Text>

          {isOwner ? (
            <TouchableOpacity
              style={modalStyles.actionRow}
              activeOpacity={0.7}
              onPress={() => onSetRole(member.profile_id, isAdminRole ? 'member' : 'admin')}
            >
              <Ionicons
                name={isAdminRole ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
                size={20}
                color={COLORS.text}
              />
              <Text style={modalStyles.actionText}>
                {isAdminRole ? 'Demote to member' : 'Make admin'}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={modalStyles.actionRow}
            activeOpacity={0.7}
            onPress={() => onRemove(member)}
          >
            <Ionicons name="person-remove-outline" size={20} color="#D24A4A" />
            <Text style={[modalStyles.actionText, { color: '#D24A4A' }]}>
              Remove from group
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={modalStyles.cancelRow} activeOpacity={0.7} onPress={onClose}>
            <Text style={modalStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Edit group modal ─────────────────────────────────────────────────────
function EditGroupModal({ visible, detail, isOwner, onClose, onSaved, onDelete }) {
  const [name, setName]         = useState('');
  const [desc, setDesc]         = useState('');
  const [city, setCity]         = useState('');
  const [state, setState]       = useState('');
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy]         = useState(false);

  // Seed fields whenever the sheet opens.
  useEffect(() => {
    if (visible && detail) {
      setName(detail.name ?? '');
      setDesc(detail.description ?? '');
      setCity(detail.city ?? '');
      setState(detail.state ?? '');
      setSchedule(detail.schedule_text ?? '');
    }
  }, [visible, detail]);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your group a name.');
      return;
    }
    setBusy(true);

    // Geocode if a location is set. Failure is non-fatal — we just keep the
    // existing coordinates (update_group leaves location alone when lat/lng null).
    let lat = null, lng = null;
    const q = [city.trim(), state.trim()].filter(Boolean).join(', ');
    if (q) {
      const geo = await geocode(q);
      if (!geo.error && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        lat = geo.lat; lng = geo.lng;
      }
    }

    const { error } = await supabase.rpc('update_group', {
      p_group:         detail.id,
      p_name:          name,
      p_description:   desc,
      p_city:          city,
      p_state:         state,
      p_schedule_text: schedule,
      p_lat:           lat,
      p_lng:           lng,
    });
    setBusy(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    onSaved?.();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={modalStyles.editSheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.headerRow}>
            <Text style={modalStyles.title}>Edit Group</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
            <Field label="Name *"      value={name}     onChange={setName}     placeholder="Group name" />
            <Field label="Description" value={desc}     onChange={setDesc}     placeholder="What you do, who it's for" multiline />
            <Field label="City"        value={city}     onChange={setCity}     placeholder="Santa Rosa Beach" />
            <Field label="State"       value={state}    onChange={setState}    placeholder="FL" />
            <Field label="Schedule"    value={schedule} onChange={setSchedule} placeholder="Tuesdays 7pm" />

            {isOwner ? (
              <TouchableOpacity
                style={modalStyles.deleteRow}
                activeOpacity={0.7}
                onPress={onDelete}
              >
                <Ionicons name="trash-outline" size={18} color="#D24A4A" />
                <Text style={modalStyles.deleteText}>Delete this group</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          <PrimaryButton
            label={busy ? 'Saving…' : 'Save Changes'}
            onPress={handleSave}
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  backArrow: { fontSize: 20, color: COLORS.text },

  cover: {
    width: '100%',
    height: 200,
    backgroundColor: COLORS.surfaceAlt,
  },
  coverFallback: {
    width: '100%',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },

  name: {
    fontFamily: FONT.serifItalic,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 34,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  metaText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },
  metaDot:  { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textTertiary, marginHorizontal: 2 },

  description: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 23,
    marginTop: SPACING.md,
  },

  section: { marginTop: SPACING.lg },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
  },
  sectionAction: {
    fontFamily: FONT.semiBold,
    fontSize: 12,
    color: COLORS.sage,
  },

  // Gallery
  galleryRow: { gap: 10, paddingRight: SPACING.lg },
  photoTileWrap: { position: 'relative' },
  photoTile: {
    width: 132,
    height: 132,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  photoDelete: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddTile: {
    width: 132,
    height: 132,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmpty: {
    height: 110,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoEmptyText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textTertiary },

  // Members
  memberList: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  memberInfo: { flex: 1 },
  memberName: { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.text },
  memberHandle: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 1 },

  roleBadge: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
  },
  roleBadgeOwner: { backgroundColor: COLORS.goldBg, borderColor: '#E8D4A0' },
  roleBadgeAdmin: { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageLight },
  roleBadgeText: {
    fontFamily: FONT.semiBold,
    fontSize: 10,
    letterSpacing: 0.3,
    textTransform: 'capitalize',
  },
  roleBadgeTextOwner: { color: COLORS.gold },
  roleBadgeTextAdmin: { color: COLORS.sage },

  manageBtn: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyTitle: { fontFamily: FONT.serifItalic, fontSize: 20, color: COLORS.text, marginTop: 4 },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textSecondary },

  // Sticky CTA
  ctaBar: {
    position: 'absolute',
    bottom: 24,
    left: SPACING.lg,
    right: SPACING.lg,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.lg,
  },
  leaveBtn: {
    width: 50,
    height: 50,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
  },
  chatBtnText: { fontFamily: FONT.bold, fontSize: 15, color: COLORS.white },

  // Lightbox
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xl,
  },
  editSheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS['2xl'],
    borderTopRightRadius: RADIUS['2xl'],
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    maxHeight: '88%',
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
  title: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.md,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  actionText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  cancelRow: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 6,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelText: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.textSecondary },

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
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },

  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  deleteText: { fontFamily: FONT.semiBold, fontSize: 14, color: '#D24A4A' },
});
