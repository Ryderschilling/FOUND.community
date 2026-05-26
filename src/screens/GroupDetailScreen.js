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
import ReportSheet from '../components/ReportSheet';
import { geocode } from '../lib/geocode';
import { firstViolation } from '../lib/contentFilter';
import {
  fetchGroupPhotos,
  pickAndUploadGroupPhoto,
  deleteGroupPhoto,
  purgeGroupPhotoStorage,
  publicUrlForGroupPhoto,
  MAX_GROUP_PHOTOS,
} from '../lib/groupPhotos';
import {
  fetchGroupPosts,
  createGroupPost,
  deleteGroupPost,
  pickGroupPostImage,
  uploadGroupPostPhoto,
  purgeGroupPostPhotoStorage,
  MAX_POST_BODY,
} from '../lib/groupPosts';

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

// Compact relative time for the activity feed: "now", "5m", "3h", "2d", or a date.
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60)     return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60)     return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)      return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)      return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const [posts, setPosts]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [busy, setBusy]               = useState(false); // join / leave
  const [openingChat, setOpeningChat] = useState(false);
  const [uploading, setUploading]     = useState(false);

  // Composer state
  const [composerBody, setComposerBody]   = useState('');
  const [composerImage, setComposerImage] = useState(null); // picked { uri, base64 }
  const [posting, setPosting]             = useState(false);

  const [editOpen, setEditOpen]               = useState(false);
  const [manageTarget, setManageTarget]       = useState(null); // member row
  const [lightbox, setLightbox]               = useState(null);
  const [membersModalOpen, setMembersModalOpen] = useState(false);

  // Pending requests state
  const [joinRequests, setJoinRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);

  // Report sheet state
  const [reportSheet, setReportSheet] = useState({ visible: false, targetKind: null, targetId: null });

  const isOwner  = detail?.my_role === 'owner';
  const isAdmin  = isOwner || detail?.my_role === 'admin';
  const isMember = !!detail?.is_member;
  const meMember = members.find((m) => m.profile_id === user?.id) ?? null;
  // Connections who are already in this group (excludes self).
  const friendsInGroup = members.filter(
    (m) => m.is_connection && m.profile_id !== user?.id,
  );
  const canPost  = (composerBody.trim().length > 0 || !!composerImage) && !posting;

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
      const [dRes, mRes, pRes, postRes] = await Promise.all([
        supabase.rpc('group_detail', { p_group: groupId }),
        supabase.rpc('group_members_list', { p_group: groupId }),
        fetchGroupPhotos(groupId),
        fetchGroupPosts(groupId),
      ]);
      if (dRes.error) console.warn('[group] detail failed', dRes.error.message);
      else setDetail((dRes.data ?? [])[0] ?? null);
      if (mRes.error) console.warn('[group] members failed', mRes.error.message);
      else setMembers(mRes.data ?? []);
      if (pRes.error) console.warn('[group] photos failed', pRes.error.message);
      else setPhotos(pRes.photos ?? []);
      if (postRes.error) console.warn('[group] posts failed', postRes.error.message);
      else setPosts(postRes.posts ?? []);
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

  const refreshPosts = useCallback(async () => {
    const { posts: p } = await fetchGroupPosts(groupId);
    setPosts(p ?? []);
  }, [groupId]);

  const loadJoinRequests = useCallback(async () => {
    if (!groupId || !isAdmin) return;
    setLoadingRequests(true);
    const { data, error } = await supabase.rpc('list_join_requests', { p_group: groupId });
    setLoadingRequests(false);
    if (error) console.warn('[group] join requests failed', error.message);
    else setJoinRequests(data ?? []);
  }, [groupId, isAdmin]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleJoin() {
    if (busy || !groupId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('join_group', { p_group: groupId });
    setBusy(false);
    if (error) { Alert.alert('Could not join', error.message); return; }
    // data is the result (either 'joined' or 'pending')
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

  // ── Posts / activity feed ────────────────────────────────────────────────
  async function handlePickPostImage() {
    if (posting) return;
    const { picked, error } = await pickGroupPostImage('library');
    if (error) { Alert.alert('Could not add photo', error.message); return; }
    if (picked) setComposerImage(picked);
  }

  async function handleSubmitPost() {
    if (posting) return;
    const body = composerBody.trim();
    if (!body && !composerImage) return; // nothing to post
    if (body.length > MAX_POST_BODY) {
      Alert.alert('Too long', `Posts are limited to ${MAX_POST_BODY} characters.`);
      return;
    }
    setPosting(true);
    try {
      let photoUrl = null;
      if (composerImage) {
        const up = await uploadGroupPostPhoto(groupId, composerImage);
        if (up.error) { Alert.alert('Photo upload failed', up.error.message); return; }
        photoUrl = up.url;
      }
      const { error } = await createGroupPost({ groupId, body, photoUrl });
      if (error) { Alert.alert('Could not post', error.message); return; }
      setComposerBody('');
      setComposerImage(null);
      await refreshPosts();
    } finally {
      setPosting(false);
    }
  }

  async function handleDeletePost(post) {
    const ok = await confirm({
      title: 'Delete post?',
      message: 'This removes it from the group activity feed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await deleteGroupPost(post.id, post.photo_url);
    if (error) { Alert.alert('Could not delete', error.message); return; }
    await refreshPosts();
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
    await purgeGroupPostPhotoStorage(groupId);
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

  async function handleBlockUser(profileId, profileName) {
    const ok = await confirm({
      title: 'Block this person?',
      message: `You won't see messages or activity from ${profileName || 'this person'} anymore.`,
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('block_user', { p_target: profileId });
    if (error) { Alert.alert('Could not block', error.message); return; }
    await refreshMembers();
  }

  async function handleApproveRequest(profileId) {
    const { error } = await supabase.rpc('approve_join_request', {
      p_group: groupId, p_profile: profileId,
    });
    if (error) {
      Alert.alert('Could not approve', error.message);
      return;
    }
    setJoinRequests((prev) => prev.filter((r) => r.profile_id !== profileId));
    await Promise.all([refreshMembers(), refreshDetail()]);
  }

  async function handleDeclineRequest(profileId) {
    const { error } = await supabase.rpc('decline_join_request', {
      p_group: groupId, p_profile: profileId,
    });
    if (error) {
      Alert.alert('Could not decline', error.message);
      return;
    }
    setJoinRequests((prev) => prev.filter((r) => r.profile_id !== profileId));
  }

  async function handleCancelJoinRequest() {
    if (busy || !groupId) return;
    setBusy(true);
    const { error } = await supabase.rpc('cancel_join_request', { p_group: groupId });
    setBusy(false);
    if (error) { Alert.alert('Could not cancel', error.message); return; }
    await refreshDetail();
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
        <View style={styles.navRight}>
          {!detail?.is_public && (
            <View style={styles.lockBadge}>
              <Ionicons name="lock-closed" size={13} color={COLORS.textTertiary} />
            </View>
          )}
          {isAdmin ? (
            <TouchableOpacity onPress={() => setEditOpen(true)} style={styles.backBtn} activeOpacity={0.7}>
              <Ionicons name="settings-outline" size={17} color={COLORS.text} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setReportSheet({ visible: true, targetKind: 'group', targetId: groupId })}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="flag-outline" size={16} color={COLORS.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAll({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      >
        {/* Cover / hero — square so any photo fits without bad crops */}
        <View style={styles.coverWrap}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.coverFallback, { backgroundColor: iconBg }]}>
              <Ionicons name={icon} size={52} color={iconColor} />
            </View>
          )}
        </View>

        <View style={styles.content}>
          <Text style={styles.name}>{name}</Text>

          {/* Meta row */}
          <View style={styles.metaRow}>
            <TouchableOpacity
              style={styles.memberCountBtn}
              activeOpacity={0.7}
              onPress={() => setMembersModalOpen(true)}
            >
              <Ionicons name="people-outline" size={13} color={COLORS.accent} />
              <Text style={styles.memberCountText}>
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </Text>
            </TouchableOpacity>
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

          {/* Meeting address — the RPC only returns this to members, so it
              naturally stays hidden from people just previewing the group. */}
          {detail?.address ? (
            <View style={styles.metaRow}>
              <Ionicons name="navigate-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.metaText}>{detail.address}</Text>
            </View>
          ) : null}

          {detail?.description ? (
            <Text style={styles.description}>{detail.description}</Text>
          ) : null}

          {/* Friends-in-group strip — only shown to non-members */}
          {!isMember && friendsInGroup.length > 0 ? (
            <TouchableOpacity
              style={styles.friendsStrip}
              activeOpacity={0.8}
              onPress={() => setMembersModalOpen(true)}
            >
              <View style={styles.friendsAvatarStack}>
                {friendsInGroup.slice(0, 4).map((m, i) => (
                  <View
                    key={m.profile_id}
                    style={[styles.friendsAvatarWrap, { zIndex: 10 - i, marginLeft: i === 0 ? 0 : -10 }]}
                  >
                    <Avatar
                      uri={m.avatar_url || undefined}
                      initials={initialsFor(m.full_name)}
                      size={30}
                      gradientColors={gradientFor(m.profile_id)}
                    />
                  </View>
                ))}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.friendsStripText}>
                  {friendsInGroup.length === 1
                    ? `${friendsInGroup[0].full_name?.split(' ')[0] || 'A connection'} is in this group`
                    : friendsInGroup.length === 2
                    ? `${friendsInGroup[0].full_name?.split(' ')[0]} & ${friendsInGroup[1].full_name?.split(' ')[0]} are here`
                    : `${friendsInGroup[0].full_name?.split(' ')[0]} and ${friendsInGroup.length - 1} other connections are here`}
                </Text>
                <Text style={styles.friendsStripSub}>Tap to see all members</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textTertiary} />
            </TouchableOpacity>
          ) : null}

          {/* Pending join requests — owner/admin only, private groups */}
          {isAdmin && !detail?.is_public && joinRequests.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeadRow}>
                <Text style={styles.sectionLabel}>
                  JOIN REQUESTS · {joinRequests.length}
                </Text>
              </View>
              <View style={styles.joinRequestsList}>
                {joinRequests.map((req) => (
                  <View key={req.profile_id} style={styles.joinRequestRow}>
                    <Avatar
                      uri={req.avatar_url || undefined}
                      initials={initialsFor(req.full_name)}
                      size={36}
                      gradientColors={gradientFor(req.profile_id)}
                    />
                    <View style={styles.joinRequestInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {req.full_name || 'Member'}
                      </Text>
                      {req.handle ? (
                        <Text style={styles.memberHandle} numberOfLines={1}>@{req.handle}</Text>
                      ) : null}
                      <Text style={styles.requestedAtText}>
                        {timeAgo(req.requested_at)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.requestBtnApprove]}
                      onPress={() => handleApproveRequest(req.profile_id)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="checkmark" size={16} color={COLORS.white} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.requestBtnDecline]}
                      onPress={() => handleDeclineRequest(req.profile_id)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Activity feed */}
          <View style={styles.section}>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionLabel}>
                ACTIVITY{posts.length ? ` · ${posts.length}` : ''}
              </Text>
            </View>

            {/* Composer — members + admins only */}
            {isMember ? (
              <View style={styles.composer}>
                <View style={styles.composerTop}>
                  <Avatar
                    uri={meMember?.avatar_url || undefined}
                    initials={initialsFor(meMember?.full_name)}
                    size={36}
                    gradientColors={gradientFor(user?.id)}
                  />
                  <TextInput
                    style={styles.composerInput}
                    value={composerBody}
                    onChangeText={setComposerBody}
                    placeholder="Share something with the group…"
                    placeholderTextColor={COLORS.textTertiary}
                    multiline
                    maxLength={MAX_POST_BODY}
                  />
                </View>

                {composerImage ? (
                  <View style={styles.composerPreviewWrap}>
                    <Image source={{ uri: composerImage.uri }} style={styles.composerPreview} />
                    <TouchableOpacity
                      style={styles.composerPreviewRemove}
                      onPress={() => setComposerImage(null)}
                      hitSlop={8}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close" size={14} color={COLORS.white} />
                    </TouchableOpacity>
                  </View>
                ) : null}

                <View style={styles.composerActions}>
                  <TouchableOpacity
                    style={styles.composerPhotoBtn}
                    onPress={handlePickPostImage}
                    disabled={posting}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="image-outline" size={18} color={COLORS.textSecondary} />
                    <Text style={styles.composerPhotoText}>
                      {composerImage ? 'Change photo' : 'Photo'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.composerPostBtn, !canPost && styles.composerPostBtnDisabled]}
                    onPress={handleSubmitPost}
                    disabled={!canPost}
                    activeOpacity={0.85}
                  >
                    {posting ? (
                      <ActivityIndicator color={COLORS.white} size="small" />
                    ) : (
                      <Text style={styles.composerPostText}>Post</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* Posts */}
            {posts.length === 0 ? (
              <View style={styles.postsEmpty}>
                <Ionicons name="chatbubbles-outline" size={22} color={COLORS.textTertiary} />
                <Text style={styles.postsEmptyText}>
                  {isMember
                    ? 'No posts yet — share the first update.'
                    : 'No activity in this group yet.'}
                </Text>
              </View>
            ) : (
              <View style={styles.postList}>
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onDelete={handleDeletePost}
                    onViewPhoto={(url) => setLightbox({ url })}
                    canReport={post.author_id !== user?.id}
                    onReport={() => setReportSheet({ visible: true, targetKind: 'group_post', targetId: post.id })}
                  />
                ))}
              </View>
            )}
          </View>

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
                const canBlockOrReport = m.profile_id !== user?.id;
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
                    {canManage || canBlockOrReport ? (
                      <MemberActionsMenu
                        member={m}
                        canManage={canManage}
                        canBlockOrReport={canBlockOrReport}
                        onSetRole={handleSetRole}
                        onRemove={handleRemoveMember}
                        onBlock={handleBlockUser}
                        onReport={() => setReportSheet({ visible: true, targetKind: 'profile', targetId: m.profile_id })}
                      />
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
          detail?.has_pending_request ? (
            <PrimaryButton
              label={busy ? 'Canceling…' : 'Request Pending'}
              onPress={handleCancelJoinRequest}
              disabled={busy}
              loading={busy}
              style={{ flex: 1 }}
            />
          ) : (
            <PrimaryButton
              label={busy ? 'Joining…' : (!detail?.is_public ? 'Request to Join' : 'Join Group')}
              onPress={handleJoin}
              disabled={busy}
              loading={busy}
              style={{ flex: 1 }}
            />
          )
        ) : (
          <>
            {!isOwner ? (
              <TouchableOpacity
                style={styles.leaveBtn}
                onPress={handleLeave}
                disabled={busy}
                activeOpacity={0.8}
              >
                <Ionicons name="exit-outline" size={18} color={COLORS.textSecondary} />
                <Text style={styles.leaveBtnText}>Leave</Text>
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
                  <Text style={styles.chatBtnText}>Message Group</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Lightbox */}
      <PhotoLightbox photo={lightbox} onClose={() => setLightbox(null)} />

      {/* Members list modal */}
      <MembersModal
        visible={membersModalOpen}
        members={members}
        currentUserId={user?.id}
        onClose={() => setMembersModalOpen(false)}
      />

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

      {/* Report sheet */}
      <ReportSheet
        visible={reportSheet.visible}
        targetKind={reportSheet.targetKind}
        targetId={reportSheet.targetId}
        onClose={() => setReportSheet({ visible: false, targetKind: null, targetId: null })}
        onReported={() => {
          setReportSheet({ visible: false, targetKind: null, targetId: null });
          Alert.alert('Report submitted', 'Thank you for helping keep FOUND safe.');
        }}
      />
    </SafeAreaView>
  );
}

// ─── Members modal ────────────────────────────────────────────────────────
function MembersModal({ visible, members = [], currentUserId, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[modalStyles.sheet, { maxHeight: '80%' }]}>
          <View style={modalStyles.handle} />
          <View style={[modalStyles.headerRow, { marginBottom: SPACING.sm }]}>
            <Text style={modalStyles.title}>
              Members · {members.length}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.md }}>
            {members.map((m) => (
              <View key={m.profile_id} style={styles.memberRow}>
                <Avatar
                  uri={m.avatar_url || undefined}
                  initials={initialsFor(m.full_name)}
                  size={40}
                  gradientColors={gradientFor(m.profile_id)}
                />
                <View style={styles.memberInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.full_name || 'Member'}
                      {m.profile_id === currentUserId ? '  (you)' : ''}
                    </Text>
                    {m.is_connection && m.profile_id !== currentUserId ? (
                      <View style={styles.connectionBadge}>
                        <Text style={styles.connectionBadgeText}>Connected</Text>
                      </View>
                    ) : null}
                  </View>
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
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
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

// ─── Post card ────────────────────────────────────────────────────────────
function PostCard({ post, onDelete, onViewPhoto, canReport, onReport }) {
  const isStaff = post.author_role === 'owner' || post.author_role === 'admin';
  return (
    <View style={styles.postCard}>
      <View style={styles.postHead}>
        <Avatar
          uri={post.author_avatar || undefined}
          initials={initialsFor(post.author_name)}
          size={36}
          gradientColors={gradientFor(post.author_id)}
        />
        <View style={styles.postHeadInfo}>
          <View style={styles.postNameRow}>
            <Text style={styles.postAuthor} numberOfLines={1}>
              {post.author_name || 'Member'}
            </Text>
            {isStaff ? (
              <View style={[
                styles.roleBadge,
                styles.postRoleBadge,
                post.author_role === 'owner' ? styles.roleBadgeOwner : styles.roleBadgeAdmin,
              ]}>
                <Text style={[
                  styles.roleBadgeText,
                  post.author_role === 'owner' ? styles.roleBadgeTextOwner : styles.roleBadgeTextAdmin,
                ]}>
                  {post.author_role}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.postTime}>{timeAgo(post.created_at)}</Text>
        </View>
        {post.can_delete || canReport ? (
          <PostActionsMenu post={post} onDelete={onDelete} canReport={canReport} onReport={onReport} />
        ) : null}
      </View>

      {post.body ? <Text style={styles.postBody}>{post.body}</Text> : null}

      {post.photo_url ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => onViewPhoto(post.photo_url)}>
          <Image source={{ uri: post.photo_url }} style={styles.postPhoto} />
        </TouchableOpacity>
      ) : null}
    </View>
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
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy]         = useState(false);

  // Seed fields whenever the sheet opens.
  useEffect(() => {
    if (visible && detail) {
      setName(detail.name ?? '');
      setDesc(detail.description ?? '');
      setCity(detail.city ?? '');
      setState(detail.state ?? '');
      setSchedule(detail.schedule_text ?? '');
      setIsPublic(detail.is_public ?? true);
    }
  }, [visible, detail]);

  async function handleSave() {
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
    if (error) {
      setBusy(false);
      Alert.alert('Could not save', error.message);
      return;
    }

    // Separately set privacy if owner
    if (isOwner && detail.is_public !== isPublic) {
      const privError = await supabase.rpc('set_group_privacy', {
        p_group: detail.id,
        p_is_public: isPublic,
      });
      if (privError?.error) {
        setBusy(false);
        Alert.alert('Could not update privacy', privError.error.message);
        return;
      }
    }

    setBusy(false);
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
              <View style={modalStyles.field}>
                <Text style={modalStyles.fieldLabel}>GROUP PRIVACY</Text>
                <View style={modalStyles.privacyRow}>
                  <TouchableOpacity
                    style={[
                      modalStyles.privacyOption,
                      isPublic && modalStyles.privacyOptionSelected,
                    ]}
                    onPress={() => setIsPublic(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="globe-outline"
                      size={18}
                      color={isPublic ? COLORS.accent : COLORS.textSecondary}
                    />
                    <Text
                      style={[
                        modalStyles.privacyOptionText,
                        isPublic && modalStyles.privacyOptionTextSelected,
                      ]}
                    >
                      Public
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      modalStyles.privacyOption,
                      !isPublic && modalStyles.privacyOptionSelected,
                    ]}
                    onPress={() => setIsPublic(false)}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color={!isPublic ? COLORS.accent : COLORS.textSecondary}
                    />
                    <Text
                      style={[
                        modalStyles.privacyOptionText,
                        !isPublic && modalStyles.privacyOptionTextSelected,
                      ]}
                    >
                      Private
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={modalStyles.privacyHelper}>
                  Private groups require you to approve join requests.
                </Text>
              </View>
            ) : null}

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

// ─── Member actions menu ──────────────────────────────────────────────────
function MemberActionsMenu({ member, canManage, canBlockOrReport, onSetRole, onRemove, onBlock, onReport }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdminRole = member.role === 'admin';

  if (!canManage && !canBlockOrReport) return null;

  return (
    <>
      <TouchableOpacity
        onPress={() => setMenuOpen(true)}
        hitSlop={8}
        style={styles.manageBtn}
        activeOpacity={0.7}
      >
        <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal visible={menuOpen} animationType="slide" transparent onRequestClose={() => setMenuOpen(false)}>
        <View style={modalStyles.backdrop}>
          <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />
            <Text style={modalStyles.title}>{member.full_name || 'Member'}</Text>

            {canManage ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onSetRole(member.profile_id, isAdminRole ? 'member' : 'admin');
                }}
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

            {canManage ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onRemove(member);
                }}
              >
                <Ionicons name="person-remove-outline" size={20} color="#D24A4A" />
                <Text style={[modalStyles.actionText, { color: '#D24A4A' }]}>
                  Remove from group
                </Text>
              </TouchableOpacity>
            ) : null}

            {canBlockOrReport ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onBlock(member.profile_id, member.full_name);
                }}
              >
                <Ionicons name="ban-outline" size={20} color="#D24A4A" />
                <Text style={[modalStyles.actionText, { color: '#D24A4A' }]}>
                  Block
                </Text>
              </TouchableOpacity>
            ) : null}

            {canBlockOrReport ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onReport();
                }}
              >
                <Ionicons name="flag-outline" size={20} color={COLORS.text} />
                <Text style={modalStyles.actionText}>Report</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={modalStyles.cancelRow} activeOpacity={0.7} onPress={() => setMenuOpen(false)}>
              <Text style={modalStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Post actions menu ─────────────────────────────────────────────────────
function PostActionsMenu({ post, onDelete, canReport, onReport }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setMenuOpen(true)}
        hitSlop={8}
        style={styles.postDeleteBtn}
        activeOpacity={0.7}
      >
        <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal visible={menuOpen} animationType="slide" transparent onRequestClose={() => setMenuOpen(false)}>
        <View style={modalStyles.backdrop}>
          <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
          <View style={modalStyles.sheet}>
            <View style={modalStyles.handle} />

            {post.can_delete ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onDelete(post);
                }}
              >
                <Ionicons name="trash-outline" size={20} color="#D24A4A" />
                <Text style={[modalStyles.actionText, { color: '#D24A4A' }]}>Delete post</Text>
              </TouchableOpacity>
            ) : null}

            {canReport ? (
              <TouchableOpacity
                style={modalStyles.actionRow}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuOpen(false);
                  onReport();
                }}
              >
                <Ionicons name="flag-outline" size={20} color={COLORS.text} />
                <Text style={modalStyles.actionText}>Report</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={modalStyles.cancelRow} activeOpacity={0.7} onPress={() => setMenuOpen(false)}>
              <Text style={modalStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
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

  coverWrap: {
    width: '100%',
    aspectRatio: 1, // square — same aspect as the picker and list thumbnail
    backgroundColor: COLORS.surfaceAlt,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  coverFallback: {
    width: '100%',
    height: '100%',
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

  // Composer
  composer: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
  },
  composerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 140,
    paddingTop: 8,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 21,
  },
  composerPreviewWrap: {
    position: 'relative',
    marginTop: SPACING.sm,
  },
  composerPreview: {
    width: '100%',
    height: 170,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
  },
  composerPreviewRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
  },
  composerPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  composerPhotoText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  composerPostBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 20,
    height: 36,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerPostBtnDisabled: {
    backgroundColor: COLORS.border,
  },
  composerPostText: {
    fontFamily: FONT.bold,
    fontSize: 14,
    color: COLORS.white,
  },

  // Join requests
  joinRequestsList: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  joinRequestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  joinRequestInfo: { flex: 1 },
  requestedAtText: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  requestBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestBtnApprove: {
    backgroundColor: COLORS.sage,
  },
  requestBtnDecline: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Posts feed
  postsEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.lg,
  },
  postsEmptyText: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  postList: { gap: SPACING.sm },
  postCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  postHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  postHeadInfo: { flex: 1 },
  postNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postAuthor: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
    flexShrink: 1,
  },
  postRoleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  postTime: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  postDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postBody: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
    marginTop: SPACING.sm,
  },
  postPhoto: {
    width: '100%',
    height: 220,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceAlt,
    marginTop: SPACING.sm,
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

  // Tappable member count in meta row
  memberCountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  memberCountText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.accent,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },

  // Friends-in-group strip (shown to non-members)
  friendsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  friendsAvatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  friendsAvatarWrap: {
    borderWidth: 2,
    borderColor: COLORS.surface,
    borderRadius: RADIUS.full,
  },
  friendsStripText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
  },
  friendsStripSub: {
    fontFamily: FONT.regular,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  // Connection badge in members modal
  connectionBadge: {
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
  },
  connectionBadgeText: {
    fontFamily: FONT.semiBold,
    fontSize: 9,
    letterSpacing: 0.3,
    color: COLORS.sage,
    textTransform: 'uppercase',
  },

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 50,
    paddingHorizontal: 16,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  leaveBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.textSecondary,
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

  privacyRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  privacyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  privacyOptionSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  privacyOptionText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  privacyOptionTextSelected: {
    color: COLORS.white,
  },
  privacyHelper: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
  },

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
