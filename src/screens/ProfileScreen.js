import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
  Modal,
  Dimensions,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Pill, SectionHeader } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { pickAndUploadAvatar } from '../lib/uploadAvatar';
import {
  pickAndUploadProfilePhoto,
  fetchProfilePhotos,
  deleteProfilePhoto,
  MAX_PHOTOS,
} from '../lib/profilePhotos';
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

// ─── Sub-components ───────────────────────────────────────────────────────
function StatCard({ value, label, onPress }) {
  const Inner = (
    <>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.8}>
        {Inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.statCard}>{Inner}</View>;
}

// GroupsModal — centered fade popup listing the user's groups.
// Tap a row → GroupDetail. Dismiss = backdrop tap or X.
function GroupsModal({ visible, onClose, onOpen }) {
  const [groups,  setGroups]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1,    duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1,    tension: 280,  friction: 22, useNativeDriver: true }),
      ]).start();
      // Fetch on open
      (async () => {
        setLoading(true); setFailed(false);
        const { data, error } = await supabase.rpc('my_groups_feed');
        if (error) { setFailed(true); }
        else {
          // my_groups_feed returns both joined + suggested; filter to joined only
          setGroups((data ?? []).filter((g) => g.is_member));
        }
        setLoading(false);
      })();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0,    duration: 130, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.95, duration: 130, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.connModalRoot, { opacity: fadeAnim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.connModalSheet, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.connModalHeader}>
            <View>
              <Text style={styles.headerMeta}>Your Community</Text>
              <Text style={styles.connModalTitle}>Groups · {loading ? '…' : groups.length}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.connModalClose}>
              <Ionicons name="close" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.connEmpty}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : failed ? (
            <View style={styles.connEmpty}>
              <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.connEmptyTitle}>Couldn't load groups</Text>
            </View>
          ) : groups.length === 0 ? (
            <View style={styles.connEmpty}>
              <Ionicons name="grid-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.connEmptyTitle}>No groups yet</Text>
              <Text style={styles.connEmptyBody}>
                Join a group in the Groups tab to see it here.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.lg }}
              showsVerticalScrollIndicator={false}
            >
              {groups.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.connRow, { paddingVertical: SPACING.sm + 4, gap: SPACING.md }]}
                  activeOpacity={0.85}
                  onPress={() => onOpen?.(g)}
                >
                  <View style={styles.groupIconWrap}>
                    <Ionicons name="people-outline" size={20} color={COLORS.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.connRowName}>{g.name || 'Unnamed Group'}</Text>
                    <Text style={styles.connRowMeta} numberOfLines={1}>
                      {[
                        g.member_count != null ? `${g.member_count} members` : null,
                        g.city && g.state ? `${g.city}, ${g.state}` : null,
                      ].filter(Boolean).join(' · ') || ' '}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ConnectionsModal — list of mutual connections (LinkedIn-style "Connected").
// Tap a row → opens MatchDetail. Long-press or tap the trash icon → remove.
const DESTRUCTIVE_RED = '#D24A4A';

function ConnectionsModal({ visible, rows = [], loading, onClose, onOpen, onRemove }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  // Track which row is pending removal for the inline confirm.
  // Using local state instead of useConfirm() avoids the z-index bug where
  // a second <Modal> renders behind this one on web.
  const [pendingRemove, setPendingRemove] = React.useState(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1,    duration: 180, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1,    tension: 280,  friction: 22, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 0,    duration: 130, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.95, duration: 130, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.connModalRoot, { opacity: fadeAnim }]}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View style={[styles.connModalSheet, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.connModalHeader}>
            <View>
              <Text style={styles.headerMeta}>Your Network</Text>
              <Text style={styles.connModalTitle}>Connected · {rows.length}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.connModalClose}>
              <Ionicons name="close" size={20} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.connEmpty}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.connEmpty}>
              <Ionicons name="people-outline" size={28} color={COLORS.textTertiary} />
              <Text style={styles.connEmptyTitle}>No connections yet</Text>
              <Text style={styles.connEmptyBody}>
                When someone accepts your request, they'll show up here.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg }}
              showsVerticalScrollIndicator={false}
            >
              {rows.map((row) => {
                const name     = row.full_name || row.handle || 'Someone';
                const initials = initialsFor(name);
                const grad     = gradientFor(row.profile_id);
                const loc      = [row.city, row.state].filter(Boolean).join(', ');
                return (
                  <View key={row.profile_id} style={styles.connRow}>
                    <TouchableOpacity
                      style={styles.connRowMain}
                      activeOpacity={0.85}
                      onPress={() => onOpen?.(row)}
                    >
                      <Avatar
                        initials={initials}
                        size={44}
                        gradientColors={grad}
                        uri={row.avatar_url || undefined}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.connRowName}>{name}</Text>
                        <Text style={styles.connRowMeta} numberOfLines={1}>
                          {[row.life_stage_label, loc].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.connRemoveBtn}
                      hitSlop={8}
                      activeOpacity={0.7}
                      onPress={() => setPendingRemove(row)}
                    >
                      <Ionicons name="person-remove-outline" size={17} color={DESTRUCTIVE_RED} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}
          {/* Inline confirm — rendered inside this Modal so it's never behind it */}
          {pendingRemove ? (
            <View style={styles.connInlineConfirm}>
              <Text style={styles.connInlineTitle}>Remove connection?</Text>
              <Text style={styles.connInlineMsg}>
                You and {pendingRemove.full_name || pendingRemove.handle || 'this person'} will no longer be connected.
              </Text>
              <View style={styles.connInlineActions}>
                <TouchableOpacity
                  style={[styles.connInlineBtn, styles.connInlineBtnCancel]}
                  onPress={() => setPendingRemove(null)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.connInlineBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.connInlineBtn, styles.connInlineBtnRemove]}
                  onPress={() => {
                    onRemove?.(pendingRemove);
                    setPendingRemove(null);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.connInlineBtnRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// HighlightReel — single horizontal row of profile photo thumbnails.
// Renders one empty "add" tile at the end (up to MAX_PHOTOS total).
// Empty slot: tap to add a photo. Filled slot: tap to view (lightbox).
// X badge on a filled slot: tap to delete (with confirm).
//
// Row extends flush to both screen edges (negative margin bleed past the
// parent's padding). A LinearGradient masks the right edge so the rightmost
// visible tile fades into the page background — visually cues "scroll to
// reveal more" even when content technically fits.
//
// Tile size is computed from window width so the row always shows ~5 tiles
// across on desktop, no matter the viewport. On narrow (mobile) screens it
// falls back to a fixed size that fits the phone width comfortably.
const REEL_GAP        = 12;
const REEL_FADE       = 100; // width of the right-edge fade overlay
const REEL_TARGET     = 5;   // desktop target: 5 tiles visible across
const REEL_TILE_MIN   = 140; // mobile fallback (~2 tiles visible on phone)

function computeTileSize(winWidth) {
  if (winWidth < 800) return REEL_TILE_MIN;
  // Reserve fade width on the right so the 5th tile sits inside the fade zone
  const usable = winWidth - REEL_FADE;
  return Math.floor(usable / REEL_TARGET) - REEL_GAP;
}

function HighlightReel({ photos = [], onAdd, onView, onDelete, busyIndex = -1 }) {
  const showAddTile = photos.length < MAX_PHOTOS;
  const scrollRef = useRef(null);
  const offsetRef = useRef(0);

  // Recompute tile size whenever the window resizes (web users dragging the
  // browser; orientation changes on tablets). Mobile screens hit the floor.
  const { width: winW } = useWindowDimensions();
  const tileSize = computeTileSize(winW);
  const tileStyle = { width: tileSize, height: tileSize };
  const scrollStep = (tileSize + REEL_GAP) * 2; // arrow nudge: 2 tiles per click

  const scrollBy = (dx) => {
    const next = Math.max(0, offsetRef.current + dx);
    scrollRef.current?.scrollTo?.({ x: next, animated: true });
  };

  return (
    <View style={styles.reelWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x; }}
        style={styles.reelScroll}
        contentContainerStyle={styles.reelScrollContent}
      >
        {photos.map((photo, i) => (
          <TouchableOpacity
            key={photo.id}
            style={[styles.reelSlot, tileStyle]}
            activeOpacity={0.85}
            onPress={() => onView?.(photo, i)}
          >
            <Image source={{ uri: photo.url }} style={styles.reelImage} />
            {/* Delete badge is its own touchable — nested press wins over the
                tile press, so tapping the X only fires onDelete, not onView. */}
            <TouchableOpacity
              style={styles.reelDeleteBadge}
              activeOpacity={0.7}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              onPress={() => onDelete?.(photo, i)}
            >
              <Ionicons name="close" size={13} color={COLORS.white} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}

        {showAddTile ? (
          <TouchableOpacity
            style={[styles.reelSlot, tileStyle]}
            activeOpacity={0.8}
            onPress={onAdd}
            disabled={busyIndex === photos.length}
          >
            <View style={styles.reelEmpty}>
              {busyIndex === photos.length ? (
                <ActivityIndicator size="small" color={COLORS.textSecondary} />
              ) : (
                <Ionicons name="add" size={20} color={COLORS.textTertiary} />
              )}
            </View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Right-edge fade — visually dissolves the rightmost tile into the
          page bg, suggesting "more beyond." pointerEvents none so it doesn't
          intercept taps on whatever sits underneath it. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(247,244,239,0)', COLORS.bg]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.reelFade}
      />

      {/* Arrow controls — web only; native users swipe. */}
      {Platform.OS === 'web' ? (
        <>
          <TouchableOpacity
            style={[styles.reelArrow, styles.reelArrowLeft]}
            activeOpacity={0.8}
            onPress={() => scrollBy(-scrollStep)}
          >
            <Ionicons name="chevron-back" size={16} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reelArrow, styles.reelArrowRight]}
            activeOpacity={0.8}
            onPress={() => scrollBy(scrollStep)}
          >
            <Ionicons name="chevron-forward" size={16} color={COLORS.text} />
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

// PhotoLightbox — full-screen image viewer.
// Tap the backdrop or the close button to dismiss.
// Image is letterboxed (resizeMode contain) so portrait + landscape both fit.
function PhotoLightbox({ photo, onClose }) {
  const { width, height } = Dimensions.get('window');
  return (
    <Modal
      visible={!!photo}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.lightboxRoot}>
        {/* Backdrop — tap to close */}
        <TouchableOpacity
          activeOpacity={1}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        {photo ? (
          <Image
            source={{ uri: photo.url }}
            style={{ width: width * 0.95, height: height * 0.85 }}
            resizeMode="contain"
          />
        ) : null}
        <TouchableOpacity
          style={styles.lightboxClose}
          activeOpacity={0.8}
          onPress={onClose}
        >
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function SettingsItem({ iconName, label, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.settingsItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.settingsIconWrap}>
        <Ionicons name={iconName} size={18} color={danger ? '#C0392B' : COLORS.textSecondary} />
      </View>
      <Text style={[styles.settingsLabel, danger && styles.settingsDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const confirm = useConfirm();

  const [profile, setProfile]     = useState(null);
  const [stats, setStats]         = useState({ matches: null, connections: null, groups: null });
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [photos, setPhotos]       = useState([]);
  const [photoBusyIdx, setPhotoBusyIdx] = useState(-1);
  const [viewerPhoto, setViewerPhoto]   = useState(null);
  const [connections, setConnections]   = useState([]);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [groupsOpen,       setGroupsOpen]      = useState(false);

  const load = useCallback(async ({ isRefresh } = {}) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // Joined profile + taxonomy details, single round trip
      const profileQ = supabase
        .from('profiles')
        .select(`
          id, full_name, handle, bio, city, state, is_initiator, is_outgoing, avatar_url,
          life_stage:life_stages(id,label,icon,icon_color),
          church:churches(id,name,city,state),
          profile_activities(activity:activities(id,label,icon,icon_color))
        `)
        .eq('id', user.id)
        .maybeSingle();

      // Stats — three small queries in parallel.
      // "Connected" now uses my_connections() RPC which returns MUTUAL likes
      // (LinkedIn-style accepted connections), not raw outbound requests.
      const connectionsQ = supabase.rpc('my_connections');

      const groupsQ = supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id);

      const matchesQ = supabase.rpc('top_matches_detailed', { p_limit: 99 });

      // Highlight reel photos (own profile)
      const photosQ = fetchProfilePhotos(user.id);

      const [pRes, cRes, gRes, mRes, phRes] = await Promise.all([
        profileQ,
        connectionsQ,
        groupsQ,
        matchesQ,
        photosQ,
      ]);

      if (pRes.error) throw pRes.error;
      setProfile(pRes.data);
      const connList = cRes.error ? [] : (cRes.data ?? []);
      setConnections(connList);
      setStats({
        matches:     mRes.error ? null : (mRes.data?.length ?? 0),
        connections: cRes.error ? null : connList.length,
        groups:      gRes.error ? null : (gRes.count ?? 0),
      });
      if (!phRes.error) setPhotos(phRes.photos);
    } catch (e) {
      console.warn('[profile] load failed', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Refresh whenever returning to the screen (e.g. after EditProfile save)
  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => load({ isRefresh: true }));
    return unsub;
  }, [navigation, load]);

  // ── Avatar change flow ──────────────────────────────────────────────
  // Shows an action sheet, picks a photo, uploads to Supabase Storage,
  // updates profiles.avatar_url, and optimistically updates local state.
  async function runAvatarUpload(source) {
    if (uploadingAvatar || !user) return;
    setUploadingAvatar(true);
    const { url, error } = await pickAndUploadAvatar({ userId: user.id, source });
    setUploadingAvatar(false);
    if (error) {
      Alert.alert('Could not update photo', error.message || 'Try again.');
      return;
    }
    if (!url) return; // user cancelled — no-op
    // Optimistic local update (avoids a full reload roundtrip)
    setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
  }

  function handleChangeAvatar() {
    // On web: skip the action sheet (Alert.alert buttons don't fire on web
    // anyway) and go straight to the library — the browser file picker is
    // the same experience either way.
    if (Platform.OS === 'web') {
      runAvatarUpload('library');
      return;
    }
    Alert.alert(
      'Update profile photo',
      undefined,
      [
        { text: 'Take photo',          onPress: () => runAvatarUpload('camera')  },
        { text: 'Choose from library', onPress: () => runAvatarUpload('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Highlight reel: add ─────────────────────────────────────────────
  async function runPhotoUpload(source) {
    if (!user) return;
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Reel is full', `You can add up to ${MAX_PHOTOS} photos. Delete one to add another.`);
      return;
    }
    const slotIdx = photos.length;     // first empty slot
    setPhotoBusyIdx(slotIdx);
    const { photo, error } = await pickAndUploadProfilePhoto({ userId: user.id, source });
    setPhotoBusyIdx(-1);
    if (error) {
      Alert.alert('Could not add photo', error.message || 'Try again.');
      return;
    }
    if (!photo) return; // cancelled
    setPhotos((prev) => [...prev, photo]);
  }

  function handleAddPhoto() {
    if (Platform.OS === 'web') {
      runPhotoUpload('library');
      return;
    }
    Alert.alert(
      'Add a photo',
      'Show off something real — a hobby, your people, where you spend time.',
      [
        { text: 'Take photo',          onPress: () => runPhotoUpload('camera')  },
        { text: 'Choose from library', onPress: () => runPhotoUpload('library') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // ── Highlight reel: delete ──────────────────────────────────────────
  async function doDelete(photo) {
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== photo.id));
    const { error } = await deleteProfilePhoto(photo.id, photo.storage_path);
    if (error) {
      setPhotos(prev); // revert
      Alert.alert('Could not delete', error.message);
    }
  }

  async function handleDeletePhoto(photo) {
    const ok = await confirm({
      title: 'Remove photo?',
      message: 'Remove this photo from your highlight reel?',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) doDelete(photo);
  }

  // Open the dedicated Edit Profile screen.
  function handleEditProfile() {
    navigation?.navigate('EditProfile');
  }

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You can sign back in anytime.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok) return;
    try { await signOut(); } catch (e) {
      Alert.alert('Sign out failed', e?.message ?? 'Try again.');
    }
  }

  async function handleDeleteAccount() {
    const ok = await confirm({
      title: 'Delete your account?',
      message: 'This permanently removes your profile, connections, messages, and groups you own. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    try {
      await supabase.rpc('delete_account');
      await signOut();
    } catch (e) {
      Alert.alert('Delete failed', e?.message ?? 'Try again.');
    }
  }

  if (loading || !profile) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.textTertiary} />
      </SafeAreaView>
    );
  }

  const name        = profile.full_name || profile.handle || 'You';
  const initials    = initialsFor(name);
  const grad        = gradientFor(profile.id);
  const locationStr = [profile.city, profile.state].filter(Boolean).join(', ') || 'Location not set';
  const interests   = (profile.profile_activities ?? [])
    .map((row) => row.activity)
    .filter(Boolean);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      >

        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={styles.headerMeta}>Your Account</Text>
          <Text style={styles.pageTitle}>Profile</Text>
        </View>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <TouchableOpacity
            onPress={handleChangeAvatar}
            activeOpacity={0.85}
            disabled={uploadingAvatar}
            style={styles.avatarWrap}
          >
            <Avatar
              initials={initials}
              size={68}
              gradientColors={grad}
              uri={profile.avatar_url || undefined}
            />
            {/* Camera badge overlay — signals avatar is tappable */}
            <View style={styles.avatarBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Ionicons name="camera" size={12} color={COLORS.white} />
              )}
            </View>
          </TouchableOpacity>
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{name}</Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={12} color={COLORS.textSecondary} />
              <Text style={styles.heroLocation}>{locationStr}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={handleEditProfile}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>

          {/* Stats — Connected is tappable; opens the network list. */}
          <View style={styles.statsRow}>
            <StatCard value={stats.matches}     label="FOUND"     />
            <StatCard
              value={stats.connections}
              label="Connected"
              onPress={() => setConnectionsOpen(true)}
            />
            <StatCard
              value={stats.groups}
              label="Groups"
              onPress={() => setGroupsOpen(true)}
            />
          </View>

          {/* Bio */}
          {profile.bio ? (
            <View style={styles.section}>
              <SectionHeader label="About" />
              <View style={styles.bioCard}>
                <Text style={styles.bioText}>{profile.bio}</Text>
              </View>
            </View>
          ) : null}

          {/* Life stage */}
          {profile.life_stage ? (
            <View style={styles.section}>
              <SectionHeader label="Life Stage" />
              <View style={styles.lifeStageCard}>
                <Ionicons
                  name={profile.life_stage.icon || 'person-outline'}
                  size={20}
                  color={profile.life_stage.icon_color ?? COLORS.textSecondary}
                />
                <Text style={styles.lifeStageText}>{profile.life_stage.label}</Text>
              </View>
            </View>
          ) : null}

          {/* Interests */}
          {interests.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader label="Interests" action="Edit" onAction={handleEditProfile} />
              <View style={styles.pillsWrap}>
                {interests.map((i) => (
                  <Pill key={i.id} label={i.label} variant="neutral" />
                ))}
              </View>
            </View>
          ) : null}

          {/* Church */}
          {profile.church ? (
            <View style={styles.section}>
              <SectionHeader label="Church" />
              <View style={styles.churchCard}>
                <View style={styles.churchIconWrap}>
                  <Ionicons name="business-outline" size={22} color={COLORS.sage} />
                </View>
                <View>
                  <Text style={styles.churchName}>{profile.church.name}</Text>
                  <Text style={styles.churchMeta}>
                    {[profile.church.city, profile.church.state].filter(Boolean).join(', ')}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Highlight Reel — tap empty to add, tap filled to remove */}
          <View style={styles.section}>
            <SectionHeader
              label={`Your Highlight Reel  ·  ${photos.length}/${MAX_PHOTOS}`}
              action={photos.length < MAX_PHOTOS ? 'Add' : undefined}
              onAction={photos.length < MAX_PHOTOS ? handleAddPhoto : undefined}
            />
            <HighlightReel
              photos={photos}
              onAdd={handleAddPhoto}
              onView={(p) => setViewerPhoto(p)}
              onDelete={handleDeletePhoto}
              busyIndex={photoBusyIdx}
            />
          </View>

          {/* Settings */}
          <View style={styles.section}>
            <SectionHeader label="Settings" />
            <View style={styles.settingsGroup}>
              <SettingsItem iconName="notifications-outline" label="Notifications"       onPress={() => navigation?.navigate('Notifications')}    />
              <SettingsItem iconName="location-outline"      label="Location Settings"   onPress={() => navigation?.navigate('LocationSettings')} />
              <SettingsItem iconName="lock-closed-outline"   label="Privacy"             onPress={() => navigation?.navigate('Privacy')}          />
              <SettingsItem iconName="help-circle-outline"   label="Help & Support"      onPress={() => navigation?.navigate('HelpSupport')}      />
              <SettingsItem iconName="ban-outline"           label="Blocked Users"       onPress={() => navigation?.navigate('BlockedUsers')}     />
              <SettingsItem iconName="log-out-outline"       label="Sign Out" danger onPress={handleSignOut} />
              <SettingsItem iconName="trash-outline"         label="Delete My Account" danger onPress={handleDeleteAccount} />
            </View>
          </View>

        </View>
      </ScrollView>

      {/* Full-screen photo viewer for highlight reel */}
      <PhotoLightbox photo={viewerPhoto} onClose={() => setViewerPhoto(null)} />

      {/* Network list popup (tapping the "Connected" stat) */}
      <ConnectionsModal
        visible={connectionsOpen}
        rows={connections}
        loading={loading}
        onClose={() => setConnectionsOpen(false)}
        onOpen={(row) => {
          setConnectionsOpen(false);
          navigation?.navigate('MatchDetail', {
            match: {
              id:          row.profile_id,
              name:        row.full_name || row.handle || 'Someone',
              handle:      row.handle || null,
              bio:         row.bio || null,
              initials:    initialsFor(row.full_name || row.handle),
              avatarUrl:   row.avatar_url || null,
              avatarColor: gradientFor(row.profile_id),
              matchScore:  null,
              lifeStage:   row.life_stage_label || '',
              distance:    [row.city, row.state].filter(Boolean).join(', ') || '',
              church:      null,
              interests:   [],
              connected:   true,
              saved:       false,
              theirKind:   'like',
              isMatch:     true,
            },
          });
        }}
        onRemove={async (row) => {
          const { error } = await supabase.rpc('remove_connection', {
            p_other: row.profile_id,
            p_kind:  'like',
          });
          if (error) {
            Alert.alert('Could not remove', error.message);
            return;
          }
          // Remove from local list + refresh stats
          setConnections((prev) => prev.filter((r) => r.profile_id !== row.profile_id));
          setStats((prev) => ({
            ...prev,
            connections: Math.max(0, (prev.connections ?? 1) - 1),
          }));
        }}
      />

      {/* Groups popup (tapping the "Groups" stat) */}
      <GroupsModal
        visible={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        onOpen={(group) => {
          setGroupsOpen(false);
          navigation?.navigate('GroupDetail', { groupId: group.id, group });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },

  pageHeader: {
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
  pageTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  avatarWrap: { position: 'relative' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  heroInfo: { flex: 1, gap: 3 },
  heroName: { fontFamily: FONT.serifItalic, fontSize: 20, color: COLORS.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroLocation: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },
  editBtn: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  editBtnText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.textSecondary },

  content: { paddingHorizontal: SPACING.lg, gap: SPACING.lg },

  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  statValue: { fontFamily: FONT.serifItalic, fontSize: 28, color: COLORS.text },
  statLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  section: { gap: SPACING.sm },

  bioCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  bioText: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.text, lineHeight: 20 },

  lifeStageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lifeStageText: { fontFamily: FONT.medium, fontSize: 15, color: COLORS.text },

  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  churchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  churchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  churchName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  churchMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  settingsGroup: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    ...SHADOW.sm,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  settingsIconWrap: { width: 24, alignItems: 'center' },
  settingsLabel: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, flex: 1 },
  settingsDanger: { color: '#C0392B' },

  // Highlight Reel — single horizontal scroll row
  // - Negative horizontal margin bleeds the row past the parent's SPACING.lg
  //   padding so it stretches edge-to-edge across the page.
  // - overflow:hidden contains the row visually; ScrollView inside still scrolls.
  reelWrap: {
    position: 'relative',
    marginHorizontal: -SPACING.lg,
    overflow: 'hidden',
  },
  reelScroll: {},
  reelScrollContent: {
    paddingLeft: SPACING.lg,
    // Extra right padding gives the fade gradient room to dissolve the last
    // tile gracefully — without it, the gradient would overlap the add tile.
    paddingRight: REEL_FADE,
    gap: REEL_GAP,
  },
  // Right-edge fade overlay — sits on top of the ScrollView at the right edge
  reelFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: REEL_FADE,
  },
  // Web-only arrow controls
  reelArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16, // half of the 32x32 button
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  reelArrowLeft:  { left:  8 },
  reelArrowRight: { right: 24 }, // pulled in so it sits on top of the fade, not at the bg edge
  reelSlot: {
    // width / height are applied inline (responsive via useWindowDimensions)
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  reelImage: {
    width: '100%',
    height: '100%',
  },
  reelDeleteBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reelEmpty: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Connections popup — centered card
  connModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  connModalSheet: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.xl,
    paddingTop: SPACING.md,
    ...SHADOW.lg,
  },
  connModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md + 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  connModalTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  connModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  connRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  connRemoveBtn: {
    paddingHorizontal: 6,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIconWrap: {
    width: 44, height: 44,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connRowName: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
  },
  connRowMeta: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  connInlineConfirm: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  connInlineTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 4,
  },
  connInlineMsg: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginBottom: SPACING.md,
  },
  connInlineActions: {
    flexDirection: 'row',
    gap: 8,
  },
  connInlineBtn: {
    flex: 1,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connInlineBtnCancel: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  connInlineBtnCancelText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  connInlineBtnRemove: {
    backgroundColor: '#D24A4A',
  },
  connInlineBtnRemoveText: {
    fontFamily: FONT.bold,
    fontSize: 14,
    color: '#fff',
  },
  connEmpty: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  connEmptyTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 17,
    color: COLORS.text,
  },
  connEmptyBody: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Photo lightbox (full-screen viewer)
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
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
