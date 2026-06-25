// ─────────────────────────────────────────────────────────────────────────
// EditProfileScreen
//
// Lets the user edit their core profile fields after onboarding:
//   - name, bio
//   - city / state
//   - life stage
//   - interests (activities)
//   - goals (community goals)
//   - church
//
// Persists via the `update_profile` RPC (migration 0009).
// On save, calls refreshProfile() so the rest of the app picks up the change.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Pressable,
  Platform,
  Modal,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, PrimaryButton, SectionHeader } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { pickAndUploadAvatar } from '../lib/uploadAvatar';
import {
  pickAndUploadProfilePhoto,
  pickAndUploadMultipleProfilePhotos,
  fetchProfilePhotos,
  deleteProfilePhoto,
  MAX_PHOTOS,
} from '../lib/profilePhotos';
import { geocode, geocodeZip } from '../lib/geocode';
import { firstViolation } from '../lib/contentFilter';
import ChurchPicker from '../components/ChurchPicker';
import {
  FAMILY_VALUES,
  SCHOOL_TYPES,
  LOVE_LANGUAGES,
  DENOMINATIONS,
  HAS_KIDS_STAGES,
} from '../data/mock';

// ── Avatar / reel helpers ──────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  ['#D4A574', '#C17F3A'], ['#7EB8C9', '#4A9AB5'], ['#9B8EC4', '#7B6BAF'],
  ['#E8A598', '#D4736A'], ['#8DC4A0', '#5FA876'], ['#C4A882', '#A8845A'],
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

const REEL_GAP      = 12;
const REEL_FADE     = 100;
const REEL_TARGET   = 5;
const REEL_TILE_MIN = 140;

function computeTileSize(winWidth) {
  if (winWidth < 800) return REEL_TILE_MIN;
  return Math.floor((winWidth - REEL_FADE) / REEL_TARGET) - REEL_GAP;
}

function HighlightReel({ photos = [], onAdd, onView, onDelete, busyIndex = -1 }) {
  const showAddTile = photos.length < MAX_PHOTOS;
  const scrollRef = useRef(null);
  const offsetRef = useRef(0);
  const { width: winW } = useWindowDimensions();
  const tileSize = computeTileSize(winW);
  const tileStyle = { width: tileSize, height: tileSize };
  const scrollStep = (tileSize + REEL_GAP) * 2;
  const scrollBy = (dx) => {
    const next = Math.max(0, offsetRef.current + dx);
    scrollRef.current?.scrollTo?.({ x: next, animated: true });
  };
  return (
    <View style={reelStyles.reelWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x; }}
        contentContainerStyle={reelStyles.reelScrollContent}
      >
        {photos.map((photo, i) => (
          <TouchableOpacity key={photo.id} style={[reelStyles.reelSlot, tileStyle]} activeOpacity={0.85} onPress={() => onView?.(photo, i)}>
            <Image source={{ uri: photo.url }} style={reelStyles.reelImage} />
            <TouchableOpacity style={reelStyles.reelDeleteBadge} activeOpacity={0.7} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} onPress={() => onDelete?.(photo, i)}>
              <Ionicons name="close" size={13} color={COLORS.white} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))}
        {showAddTile ? (
          <TouchableOpacity style={[reelStyles.reelSlot, tileStyle]} activeOpacity={0.8} onPress={onAdd} disabled={busyIndex === photos.length}>
            <View style={reelStyles.reelEmpty}>
              {busyIndex === photos.length
                ? <ActivityIndicator size="small" color={COLORS.textSecondary} />
                : <Ionicons name="add" size={20} color={COLORS.textTertiary} />}
            </View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      <LinearGradient pointerEvents="none" colors={['rgba(247,244,239,0)', COLORS.bg]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={reelStyles.reelFade} />
      {Platform.OS === 'web' ? (
        <>
          <TouchableOpacity style={[reelStyles.reelArrow, reelStyles.reelArrowLeft]} activeOpacity={0.8} onPress={() => scrollBy(-scrollStep)}>
            <Ionicons name="chevron-back" size={16} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[reelStyles.reelArrow, reelStyles.reelArrowRight]} activeOpacity={0.8} onPress={() => scrollBy(scrollStep)}>
            <Ionicons name="chevron-forward" size={16} color={COLORS.text} />
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

function PhotoLightbox({ photo, onClose }) {
  const { width: winW, height: winH } = useWindowDimensions();
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
        {photo ? (
          <Image source={{ uri: photo.url }} style={{ width: winW, height: winH * 0.85 }} resizeMode="contain" />
        ) : null}
        <TouchableOpacity style={{ position: 'absolute', top: 48, right: 20, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
          <Ionicons name="close" size={20} color={COLORS.white} />
        </TouchableOpacity>
      </Pressable>
    </Modal>
  );
}

function BinaryCard({ label, subLabel, selected, onPress }) {
  return (
    <Pressable
      style={[styles.binaryCard, selected && styles.binaryCardSelected]}
      onPress={onPress}
    >
      <Text style={[styles.binaryLabel, selected && styles.binaryLabelSelected]}>{label}</Text>
      {subLabel ? (
        <Text style={[styles.binarySubLabel, selected && styles.binarySubLabelSelected]}>{subLabel}</Text>
      ) : null}
    </Pressable>
  );
}

function OptionCard({ item, selected, onPress }) {
  return (
    <Pressable
      style={[styles.optCard, selected && styles.optCardSelected]}
      onPress={onPress}
    >
      <View style={[styles.optIconWrap, selected && styles.optIconWrapSelected]}>
        <Ionicons
          name={item.icon || 'ellipse-outline'}
          size={20}
          color={selected ? (item.icon_color ?? COLORS.accent) : COLORS.textSecondary}
        />
      </View>
      <Text style={[styles.optLabel, selected && styles.optLabelSelected]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

export default function EditProfileScreen({ navigation }) {
  const { user, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  // Form state — initialized from current profile once loaded.
  const [fullName, setFullName]         = useState('');
  const [bio, setBio]                   = useState('');
  const [phone, setPhone]               = useState('');
  // Up to 3 structured hometown city rows: [{ city, state }, ...]
  const [hometownCities, setHometownCities] = useState([
    { city: '', state: '' },
    { city: '', state: '' },
    { city: '', state: '' },
  ]);
  // Address fields (mirrors SignUpScreen)
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions]   = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [resolvedCoords, setResolvedCoords]   = useState(null);
  const [city, setCity]   = useState('');
  const [state, setState] = useState('');
  const [zip, setZip]     = useState('');
  const debounceRef  = useRef(null);
  const skipFetchRef = useRef(false);
  const [lifeStage, setLifeStage]     = useState(null);
  const [activities, setActivities]   = useState([]);    // array of activity ids
  const [goals, setGoals]             = useState([]);
  // Church is free text for now — curated directory comes later.
  // Church is committed immediately by ChurchPicker — track for display only.
  const [profileChurchId,   setProfileChurchId]   = useState(null);
  const [profileIsHome,     setProfileIsHome]     = useState(false);
  const [profileChurchName, setProfileChurchName] = useState(null);

  // Taxonomy
  const [lifeStages, setLifeStages]   = useState([]);
  const [allActivities, setAllActivities] = useState([]);
  const [allGoals, setAllGoals]       = useState([]);
  const [taxLoading, setTaxLoading]   = useState(true);

  const [politicalLean, setPoliticalLean]       = useState(null);
  const [lookingForChurch, setLookingForChurch] = useState(null);
  const [loveLanguage, setLoveLanguage]         = useState(null);
  const [familyValues, setFamilyValues]         = useState([]);
  const [schoolType, setSchoolType]             = useState(null);
  const [isInitiator, setIsInitiator]           = useState(null); // null | boolean
  const [isOutgoing, setIsOutgoing]             = useState(null); // null | boolean
  const [denomination, setDenomination]         = useState(null);
  const [saving, setSaving]                     = useState(false);
  const [scrollEnabled, setScrollEnabled]       = useState(true);

  // Photo state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [photos, setPhotos]                   = useState([]);
  const [photoBusyIdx, setPhotoBusyIdx]       = useState(-1);
  const [viewerPhoto, setViewerPhoto]         = useState(null);

  // Interests search + request-modal state
  const [interestsQuery, setInterestsQuery] = useState('');
  const [requestOpen, setRequestOpen]       = useState(false);
  const [requestName, setRequestName]       = useState('');
  const [requestDesc, setRequestDesc]       = useState('');
  const [requestBusy, setRequestBusy]       = useState(false);
  const [requestError, setRequestError]     = useState(null);
  const [requestInfo, setRequestInfo]       = useState(null);

  const filteredActivities = useMemo(() => {
    const q = interestsQuery.trim().toLowerCase();
    if (!q) return allActivities;
    return allActivities.filter((a) => (a.label || '').toLowerCase().includes(q));
  }, [interestsQuery, allActivities]);

  // ── Address autocomplete (Nominatim, same as SignUpScreen) ────────────────
  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.trim().length < 3) { setSuggestions([]); return; }
    try {
      const url =
        'https://nominatim.openstreetmap.org/search' +
        '?format=json&addressdetails=1&limit=6&countrycodes=us' +
        '&q=' + encodeURIComponent(q.trim());
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'FOUND-community-app/1.0 (found.community)' },
      });
      if (!res.ok) return;
      const data = await res.json();
      const seen = new Set();
      const results = (data ?? []).filter((r) => {
        if (seen.has(r.display_name)) return false;
        seen.add(r.display_name);
        return true;
      });
      setSuggestions(results);
    } catch { setSuggestions([]); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!addressQuery.trim()) { setSuggestions([]); setShowSuggestions(false); return; }
    if (skipFetchRef.current) { skipFetchRef.current = false; return; }
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(addressQuery);
      setShowSuggestions(true);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [addressQuery, fetchSuggestions]);

  function selectSuggestion(result) {
    skipFetchRef.current = true;
    clearTimeout(debounceRef.current);
    const a = result.address ?? {};
    const streetNum  = a.house_number || '';
    const street     = a.road || a.pedestrian || '';
    const streetLine = [streetNum, street].filter(Boolean).join(' ');
    const detectedCity  = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
    const detectedState = (a.state_code || a.state || '').slice(0, 2).toUpperCase();
    const detectedZip   = a.postcode || '';
    setAddressQuery(streetLine || detectedCity);
    setCity(detectedCity);
    setState(detectedState);
    setZip(detectedZip);
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setResolvedCoords({ lat, lng });
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function formatSuggestionLabel(result) {
    const a = result.address ?? {};
    const streetNum  = a.house_number || '';
    const street     = a.road || a.pedestrian || '';
    const streetLine = [streetNum, street].filter(Boolean).join(' ');
    const c  = a.city || a.town || a.village || a.hamlet || a.suburb || '';
    const st = (a.state_code || a.state || '').slice(0, 2).toUpperCase();
    const zp = a.postcode ? `  ${a.postcode}` : '';
    if (streetLine && c) return `${streetLine},  ${c}, ${st}${zp}`;
    if (c)               return `${c}, ${st}${zp}`;
    return (result.display_name || '').split(', United States')[0];
  }

  function closeRequestModal() {
    if (requestBusy) return;
    setRequestName('');
    setRequestDesc('');
    setRequestError(null);
    setRequestInfo(null);
    setRequestOpen(false);
  }

  async function submitInterestRequest() {
    setRequestError(null);
    setRequestInfo(null);
    const n = requestName.trim();
    if (!n) { setRequestError('Please enter an interest name.'); return; }
    if (n.length > 80) { setRequestError('Name too long (max 80).'); return; }
    if (requestDesc.trim().length > 500) {
      setRequestError('Description too long (max 500).'); return;
    }
    setRequestBusy(true);
    try {
      const { error } = await supabase.rpc('request_interest', {
        p_name: n,
        p_description: requestDesc.trim() || null,
      });
      if (error) throw error;
      setRequestInfo("Thanks! We'll review your suggestion soon.");
      setRequestName('');
      setRequestDesc('');
    } catch (e) {
      setRequestError(e?.message ?? 'Could not send. Try again.');
    } finally {
      setRequestBusy(false);
    }
  }

  // Load taxonomies + own profile detail (for activities/goals/church_name).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lsR, actR, goalR, profR, phRes, churchPrefsR] = await Promise.all([
        supabase.from('life_stages').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('activities').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('community_goals').select('id,label,icon,icon_color').order('sort_order'),
        user
          ? supabase.from('profiles')
              .select('full_name,bio,phone,hometown,hometown_cities,city,state,zip,address,life_stage_id,church_id,political_lean,looking_for_church,love_language_id,school_type_id,is_initiator,is_outgoing,denomination_id,church:churches(name),profile_activities(activity_id),profile_goals(goal_id),profile_values(value_id)')
              .eq('id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        user ? fetchProfilePhotos(user.id) : Promise.resolve({ photos: [], error: null }),
        // Use security-definer RPC to bypass PostgREST column permission issue on is_home_church
        user ? supabase.rpc('get_my_church_prefs') : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      if (!phRes.error) setPhotos(phRes.photos ?? []);
      const savedAddress = profR?.data?.address ?? '';
      setLifeStages(lsR.data ?? []);
      setAllActivities(actR.data ?? []);
      setAllGoals(goalR.data ?? []);
      const p = profR.data;
      if (p) {
        setFullName(p.full_name ?? '');
        setBio(p.bio ?? '');
        setPhone(p.phone ?? '');
        // hometown derived from hometownCities[0] on save
        // Parse existing hometown_cities array → structured rows
        // Handles "Miami, FL", "Miami FL", or plain "Miami" gracefully
        // Use hometown_cities array; fall back to legacy hometown string if empty
        const rawCities = (p.hometown_cities ?? []).filter(Boolean);
        const sourceList = rawCities.length > 0
          ? rawCities
          : (p.hometown ? [p.hometown] : []);
        const parsedRows = sourceList.slice(0, 3).map((raw) => {
          const trimmed = (raw || '').trim();
          const commaIdx = trimmed.lastIndexOf(',');
          if (commaIdx > 0) {
            return {
              city:  trimmed.slice(0, commaIdx).trim(),
              state: trimmed.slice(commaIdx + 1).trim().toUpperCase().slice(0, 2),
            };
          }
          // "Miami FL" — last word might be state abbreviation
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2 && /^[A-Z]{2}$/.test(parts[parts.length - 1].toUpperCase())) {
            return {
              city:  parts.slice(0, -1).join(' '),
              state: parts[parts.length - 1].toUpperCase(),
            };
          }
          return { city: trimmed, state: '' };
        });
        // Pad to 3 rows
        while (parsedRows.length < 3) parsedRows.push({ city: '', state: '' });
        setHometownCities(parsedRows);
        const savedCity  = p.city  ?? '';
        const savedState = p.state ?? '';
        const savedZip   = p.zip   ?? '';
        setCity(savedCity);
        setState(savedState);
        setZip(savedZip);
        // Pre-fill the address autocomplete text as the full address string:
        // "41 Windrow Way, Inlet Beach, FL 32461"
        // Build from all parts: street + city + state + zip
        {
          const streetPart  = savedAddress ? savedAddress.trim() : '';
          const cityState   = [savedCity, savedState].filter(Boolean).join(', ');
          const withZip     = [cityState, savedZip].filter(Boolean).join(' ');
          const fullDisplay = [streetPart, withZip].filter(Boolean).join(', ');
          if (fullDisplay) {
            setAddressQuery(fullDisplay);
            skipFetchRef.current = true;
          }
        }
        setLifeStage(p.life_stage_id ?? null);
        setProfileChurchId(p.church_id ?? null);
        // is_home_church read via SECURITY DEFINER RPC to bypass PostgREST column permission issue
        const churchPrefs = churchPrefsR?.data?.[0] ?? null;
        setProfileIsHome(churchPrefs?.is_home_church ?? false);
        setProfileChurchName(p.church?.name ?? null);
        setActivities((p.profile_activities ?? []).map((r) => r.activity_id));
        setGoals((p.profile_goals ?? []).map((r) => r.goal_id));
        setPoliticalLean(p.political_lean ?? null);
        setLookingForChurch(p.looking_for_church ?? null);
        setLoveLanguage(p.love_language_id ?? null);
        setSchoolType(p.school_type_id ?? null);
        setIsInitiator(p.is_initiator ?? null);
        setIsOutgoing(p.is_outgoing ?? null);
        setDenomination(p.denomination_id ?? null);
        setFamilyValues((p.profile_values ?? []).map((r) => r.value_id));
      } else if (profile) {
        setFullName(profile.full_name ?? '');
      }
      setTaxLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, profile]);

  const toggle = (setter) => (id) =>
    setter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  // ── Avatar upload ─────────────────────────────────────────────────────────
  async function runAvatarUpload(source) {
    if (uploadingAvatar || !user) return;
    setUploadingAvatar(true);
    const { url, error } = await pickAndUploadAvatar({ userId: user.id, source });
    setUploadingAvatar(false);
    if (error) {
      toast({ title: 'Could not update photo', message: error.message || 'Try again.', type: 'error' });
      return;
    }
    if (!url) return;
    await refreshProfile();
  }

  async function handleChangeAvatar() {
    if (Platform.OS === 'web') { runAvatarUpload('library'); return; }
    const ok = await confirm({
      title: 'Update profile photo',
      confirmLabel: 'Take photo',
      cancelLabel: 'Choose from library',
    });
    if (ok) { runAvatarUpload('camera'); } else { runAvatarUpload('library'); }
  }

  // ── Highlight reel ────────────────────────────────────────────────────────
  async function runPhotoUpload(source) {
    if (!user) return;
    if (photos.length >= MAX_PHOTOS) {
      toast({ title: 'Reel is full', message: `You can add up to ${MAX_PHOTOS} photos. Delete one to add another.`, type: 'info' });
      return;
    }
    const slotsLeft = MAX_PHOTOS - photos.length;
    if (source === 'camera') {
      const slotIdx = photos.length;
      setPhotoBusyIdx(slotIdx);
      const { photo, error } = await pickAndUploadProfilePhoto({ userId: user.id, source: 'camera' });
      setPhotoBusyIdx(-1);
      if (error) { toast({ title: 'Could not add photo', message: error.message || 'Try again.', type: 'error' }); return; }
      if (!photo) return;
      setPhotos((prev) => [...prev, photo]);
    } else {
      const slotIdx = photos.length;
      setPhotoBusyIdx(slotIdx);
      const { photos: added, errors, cancelled } = await pickAndUploadMultipleProfilePhotos({ userId: user.id, maxCount: slotsLeft });
      setPhotoBusyIdx(-1);
      if (cancelled) return;
      if (added.length > 0) setPhotos((prev) => [...prev, ...added]);
      if (errors.length > 0) {
        toast({ title: added.length > 0 ? 'Some photos failed' : 'Could not add photos', message: errors[0].message || 'Try again.', type: 'error' });
      }
    }
  }

  async function handleAddPhoto() {
    if (Platform.OS === 'web') { runPhotoUpload('library'); return; }
    const ok = await confirm({
      title: 'Add a photo',
      message: 'Show off something real — a hobby, your people, where you spend time.',
      confirmLabel: 'Take photo',
      cancelLabel: 'Choose from library',
    });
    if (ok) { runPhotoUpload('camera'); } else { runPhotoUpload('library'); }
  }

  async function doDelete(photo) {
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== photo.id));
    const { error } = await deleteProfilePhoto(photo.id, photo.storage_path);
    if (error) { setPhotos(prev); toast({ title: 'Could not delete', message: error.message, type: 'error' }); }
  }

  async function handleDeletePhoto(photo) {
    const ok = await confirm({ title: 'Remove photo?', message: 'Remove this photo from your highlight reel?', confirmLabel: 'Remove', destructive: true });
    if (ok) doDelete(photo);
  }

  const handleSave = useCallback(async () => {
    if (saving) return;

    const violation = firstViolation([
      { text: fullName, label: 'name' },
      { text: bio,      label: 'bio' },
    ]);
    if (!violation.ok) {
      toast({ title: 'Check your wording', message: violation.message, type: 'info' });
      return;
    }

    setSaving(true);

    // 1) Persist core profile fields
    // Convert structured rows → "City, ST" canonical strings, skip blank rows
    const parsedHometownCities = hometownCities
      .filter((r) => r.city.trim())
      .map((r) => {
        const c = r.city.trim();
        const s = r.state.trim().toUpperCase().slice(0, 2);
        return s ? `${c}, ${s}` : c;
      });

    // Derive hometown from primary city row
    const primaryRow = hometownCities[0];
    const derivedHometown = primaryRow.city.trim()
      ? primaryRow.state.trim()
        ? `${primaryRow.city.trim()}, ${primaryRow.state.trim().toUpperCase().slice(0, 2)}`
        : primaryRow.city.trim()
      : null;

    const { error } = await supabase.rpc('update_profile', {
      p_full_name:           fullName.trim() || null,
      p_bio:                 bio.trim() || null,
      p_hometown:            derivedHometown,
      p_city:                city || null,
      p_state:               state || null,
      p_life_stage:          lifeStage,
      p_church_id:           profileChurchId,
      p_activities:          activities,
      p_goals:               goals,
      p_values:              familyValues,
      p_love_language:       loveLanguage,
      p_school_type:         schoolType,
      p_is_initiator:        isInitiator,
      p_is_outgoing:         isOutgoing,
      p_hometown_cities:     parsedHometownCities.length > 0 ? parsedHometownCities : null,
      p_looking_for_church:  lookingForChurch,
      p_political_lean:      politicalLean ?? -999,
    });
    if (error) {
      setSaving(false);
      toast({ title: 'Could not save', message: error.message, type: 'error' });
      return;
    }

    // Church is committed immediately by ChurchPicker — nothing to do here.

    // 2) Persist fields not in update_profile RPC
    // NOTE: is_home_church is managed exclusively by set_profile_church RPC — do not write it here
    await supabase.from('profiles')
      .update({
        denomination_id: denomination ?? null,
        zip:     zip.trim()          || null,
        address: addressQuery.trim() || null,
        phone:   phone.trim()        || null,
      })
      .eq('id', user.id);

    // 3) Geocode → PostGIS point. Non-fatal.
    const hasLocation = city.trim() || zip.trim();
    if (hasLocation) {
      let lat = resolvedCoords?.lat ?? null;
      let lng = resolvedCoords?.lng ?? null;
      if (lat == null) {
        try {
          const q = /^\d{5}$/.test(zip.trim()) ? zip.trim() : `${city.trim()}, ${state.trim()}`;
          const geo = /^\d{5}$/.test(q) ? await geocodeZip(q) : await geocode(q);
          if (geo.lat != null) { lat = geo.lat; lng = geo.lng; }
        } catch { /* non-fatal */ }
      }
      if (lat != null && lng != null) {
        const { error: locErr } = await supabase.rpc('set_profile_location', { p_lat: lat, p_lng: lng });
        if (locErr) console.warn('[edit-profile] set location failed', locErr.message);
      }
    } else {
      await supabase.rpc('set_profile_location', { p_lat: null, p_lng: null });
    }

    await refreshProfile();
    setSaving(false);
    navigation?.goBack();
  }, [saving, fullName, bio, city, state, zip, resolvedCoords, lifeStage, activities, goals, familyValues, loveLanguage, schoolType, isInitiator, isOutgoing, denomination, politicalLean, lookingForChurch, hometownCities, refreshProfile, navigation, user]);

  if (taxLoading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator color={COLORS.textTertiary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
      >
        {/* Photos */}
        <View style={styles.section}>
          <SectionHeader label="Profile Photo" />
          <TouchableOpacity onPress={handleChangeAvatar} activeOpacity={0.85} disabled={uploadingAvatar} style={styles.avatarWrap}>
            <Avatar
              initials={initialsFor(fullName || profile?.full_name)}
              size={72}
              gradientColors={gradientFor(user?.id)}
              uri={profile?.avatar_url || undefined}
            />
            <View style={styles.avatarBadge}>
              {uploadingAvatar
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="camera" size={13} color={COLORS.white} />}
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <SectionHeader
            label={`Highlight Reel  ·  ${photos.length}/${MAX_PHOTOS}`}
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

        {/* Name */}
        <View style={styles.section}>
          <SectionHeader label="Name" />
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your name"
            placeholderTextColor={COLORS.textTertiary}
          />
        </View>

        {/* Phone */}
        <View style={styles.section}>
          <SectionHeader label="Phone" />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 555-5555"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <SectionHeader label="Bio" />
          <TextInput
            style={[styles.input, styles.textarea]}
            value={bio}
            onChangeText={setBio}
            placeholder="A few lines about you — what you're into, what you're looking for."
            placeholderTextColor={COLORS.textTertiary}
            multiline
            maxLength={500}
          />
          <Text style={styles.counter}>{bio.length}/500</Text>
        </View>

        {/* Where you're from */}
        <View style={styles.section}>
          <SectionHeader label="From" />

          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.hometownRow}>
              <TextInput
                style={[styles.input, styles.hometownCity]}
                value={hometownCities[i].city}
                onChangeText={(v) => {
                  const updated = [...hometownCities];
                  updated[i] = { ...updated[i], city: v };
                  setHometownCities(updated);
                }}
                placeholder={i === 0 ? 'City (e.g. Charleston)' : `City ${i + 1} (optional)`}
                placeholderTextColor={COLORS.textTertiary}
                autoCapitalize="words"
                maxLength={60}
              />
              <TextInput
                style={[styles.input, styles.hometownState]}
                value={hometownCities[i].state}
                onChangeText={(v) => {
                  const updated = [...hometownCities];
                  updated[i] = { ...updated[i], state: v.slice(0, 30) };
                  setHometownCities(updated);
                }}
                placeholder="ST / Cou..."
                placeholderTextColor={COLORS.textTertiary}
                autoCapitalize="words"
                maxLength={30}
              />
            </View>
          ))}
        </View>

        {/* Address */}
        <View style={styles.section}>
          <SectionHeader label="Address" />
          <Text style={styles.fieldHint}>
            Helps us find people nearby. Not shown publicly.
          </Text>

          {/* Autocomplete search */}
          <TextInput
            style={[styles.input, showSuggestions && suggestions.length > 0 && styles.inputDropdownOpen]}
            value={addressQuery}
            onChangeText={(v) => { skipFetchRef.current = false; setAddressQuery(v); setResolvedCoords(null); }}
            onFocus={() => addressQuery.trim().length >= 3 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 400)}
            placeholder="Start typing your address…"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="words"
            autoComplete="street-address"
            textContentType="fullStreetAddress"
          />

          {showSuggestions && suggestions.length > 0 ? (
            <View style={styles.dropdown}>
              {suggestions.map((feat, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.suggestionRow, i < suggestions.length - 1 && styles.suggestionDivider]}
                  onPress={() => selectSuggestion(feat)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="location-outline" size={14} color={COLORS.clay} style={{ marginTop: 2 }} />
                  <Text style={styles.suggestionText} numberOfLines={2}>
                    {formatSuggestionLabel(feat)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <Text style={[styles.hint, resolvedCoords && styles.hintConfirmed]}>
            {resolvedCoords
              ? '✓ Location confirmed'
              : suggestions.length === 0 && addressQuery.length >= 3
                ? 'No results — try a different address or fill in below.'
                : 'Type for autocomplete, or fill in city / state / ZIP below.'}
          </Text>

          {/* City / State / ZIP row */}
          <View style={[styles.addressRow, { zIndex: 1 }]}>
            <View style={styles.addressColCity}>
              <Text style={styles.addressLabel}>City</Text>
              <TextInput
                style={styles.input}
                value={city}
                onChangeText={setCity}
                autoCapitalize="words"
                placeholder="City"
                placeholderTextColor={COLORS.textTertiary}
              />
            </View>
            <View style={styles.addressColState}>
              <Text style={styles.addressLabel}>State</Text>
              <TextInput
                style={styles.input}
                value={state}
                onChangeText={(v) => setState(v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))}
                autoCapitalize="characters"
                maxLength={2}
                placeholder="ST"
                placeholderTextColor={COLORS.textTertiary}
              />
            </View>
            <View style={styles.addressColZip}>
              <Text style={styles.addressLabel}>ZIP</Text>
              <TextInput
                style={styles.input}
                value={zip}
                onChangeText={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
                keyboardType="number-pad"
                maxLength={5}
                placeholder="00000"
                placeholderTextColor={COLORS.textTertiary}
              />
            </View>
          </View>
        </View>

        {/* Life stage */}
        <View style={styles.section}>
          <SectionHeader label="Life Stage" />
          <View style={styles.optGrid}>
            {lifeStages.map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={lifeStage === item.id}
                onPress={() => setLifeStage(item.id)}
              />
            ))}
          </View>
        </View>

        {/* Love Language */}
        <View style={styles.section}>
          <SectionHeader label="Love Language" />
          <View style={styles.optGrid}>
            {LOVE_LANGUAGES.filter((l) => l.id !== 'not-sure').map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={loveLanguage === item.id}
                onPress={() => setLoveLanguage(loveLanguage === item.id ? null : item.id)}
              />
            ))}
          </View>
        </View>

        {/* Personality */}
        <View style={styles.section}>
          <SectionHeader label="Personality" />
          <Text style={styles.sectionHint}>Are you an initiator?</Text>
          <View style={styles.binaryRow}>
            <BinaryCard label="Yes" selected={isInitiator === true} onPress={() => setIsInitiator(isInitiator === true ? null : true)} />
            <BinaryCard label="Not Really" selected={isInitiator === false} onPress={() => setIsInitiator(isInitiator === false ? null : false)} />
          </View>
          <Text style={[styles.sectionHint, { marginTop: SPACING.md }]}>How would you describe yourself?</Text>
          <View style={styles.binaryRow}>
            <BinaryCard label="Outgoing" subLabel="I'll talk to anybody!" selected={isOutgoing === true} onPress={() => setIsOutgoing(isOutgoing === true ? null : true)} />
            <BinaryCard label="More Reserved" subLabel="Once I get to know you." selected={isOutgoing === false} onPress={() => setIsOutgoing(isOutgoing === false ? null : false)} />
          </View>
        </View>

        {/* Interests / activities */}
        <View style={styles.section}>
          <SectionHeader label={`Interests  ·  ${activities.length} selected`} />

          <TextInput
            style={styles.searchInput}
            placeholder="Search interests..."
            placeholderTextColor={COLORS.textTertiary}
            value={interestsQuery}
            onChangeText={setInterestsQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          {filteredActivities.length === 0 ? (
            <Text style={styles.emptyNote}>
              No interests match "{interestsQuery}". Don't see yours? Request it below.
            </Text>
          ) : (
            <View style={styles.optGrid}>
              {filteredActivities.map((item) => (
                <OptionCard
                  key={item.id}
                  item={item}
                  selected={activities.includes(item.id)}
                  onPress={() => toggle(setActivities)(item.id)}
                />
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.requestBtn}
            onPress={() => setRequestOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={18} color={COLORS.text} />
            <Text style={styles.requestBtnText}>Request an interest</Text>
          </TouchableOpacity>
        </View>

        {/* Community goals */}
        <View style={styles.section}>
          <SectionHeader label={`Looking For  ·  ${goals.length} selected`} />
          <View style={styles.optGrid}>
            {allGoals.map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={goals.includes(item.id)}
                onPress={() => toggle(setGoals)(item.id)}
              />
            ))}
          </View>
        </View>

        {/* Family Values */}
        <View style={styles.section}>
          <SectionHeader label="Home Values  ·  Optional" />
          <Text style={styles.sectionHint}>Select all that apply.</Text>
          <View style={styles.optGrid}>
            {FAMILY_VALUES.map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={familyValues.includes(item.id)}
                onPress={() => toggle(setFamilyValues)(item.id)}
              />
            ))}
          </View>
        </View>

        {/* School Type — only if user has kids */}
        {HAS_KIDS_STAGES.includes(lifeStage) ? (
          <View style={styles.section}>
            <SectionHeader label="School Type  ·  Optional" />
            <Text style={styles.sectionHint}>What type of school are your kids in?</Text>
            <View style={styles.optGrid}>
              {SCHOOL_TYPES.map((item) => (
                <OptionCard
                  key={item.id}
                  item={item}
                  selected={schoolType === item.id}
                  onPress={() => setSchoolType(schoolType === item.id ? null : item.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* Political Lean — optional */}
        <View style={styles.section}>
          <SectionHeader label="Political Views  ·  Optional" />
          <Text style={styles.sectionHint}>
            Only used to find people with similar views. Never shown publicly.{'\n'}
            You only match with others on the same side. Moderate matches no one.
          </Text>
          <PoliticalSlider value={politicalLean} onChange={setPoliticalLean} setScrollEnabled={setScrollEnabled} />
          {politicalLean !== null ? (
            <TouchableOpacity onPress={() => setPoliticalLean(null)} style={styles.clearSlider}>
              <Text style={styles.clearSliderText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Looking for a church */}
        <View style={styles.section}>
          <SectionHeader label="Looking for a Church?" />
          <Text style={styles.sectionHint}>
            We'll help you find people who are also searching for a church community.
          </Text>
          <View style={styles.churchToggleRow}>
            <TouchableOpacity
              style={[styles.churchToggleBtn, lookingForChurch === true && styles.churchToggleActive]}
              onPress={() => setLookingForChurch(lookingForChurch === true ? null : true)}
              activeOpacity={0.8}
            >
              <Ionicons name="search" size={16} color={lookingForChurch === true ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.churchToggleText, lookingForChurch === true && styles.churchToggleTextActive]}>
                Yes, looking
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.churchToggleBtn, lookingForChurch === false && styles.churchToggleActive]}
              onPress={() => setLookingForChurch(lookingForChurch === false ? null : false)}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle-outline" size={16} color={lookingForChurch === false ? COLORS.white : COLORS.textSecondary} />
              <Text style={[styles.churchToggleText, lookingForChurch === false && styles.churchToggleTextActive]}>
                Already have one
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Church — search + request via ChurchPicker */}
        <View style={styles.section}>
          <SectionHeader label="Church" />
          <ChurchPicker
            churchId={profileChurchId}
            isHomeChurch={profileIsHome}
            churchName={profileChurchName}
            lookingForChurch={lookingForChurch}
            onLookingChange={setLookingForChurch}
            toast={toast}
            onSaved={({ churchId, isHomeChurch }) => {
              setProfileChurchId(churchId);
              setProfileIsHome(isHomeChurch);
            }}
          />
        </View>
        {/* Denomination */}
        <View style={styles.section}>
          <SectionHeader label="Denomination  ·  Optional" />
          <View style={styles.optGrid}>
            {DENOMINATIONS.map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={denomination === item.id}
                onPress={() => setDenomination(denomination === item.id ? null : item.id)}
              />
            ))}
          </View>
        </View>

      </ScrollView>

      {/* Sticky save */}
      <View style={styles.footer}>
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save Changes'}
          onPress={handleSave}
          disabled={saving}
          loading={saving}
        />
      </View>

      {/* Request an interest modal */}
      <Modal
        visible={requestOpen}
        animationType="slide"
        transparent
        onRequestClose={closeRequestModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request an interest</Text>
              <TouchableOpacity onPress={closeRequestModal} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Interest name</Text>
            <TextInput
              value={requestName}
              onChangeText={setRequestName}
              placeholder="e.g. Disc Golf"
              placeholderTextColor={COLORS.textTertiary}
              style={styles.searchInput}
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={[styles.modalLabel, { marginTop: SPACING.md }]}>
              Description <Text style={{ color: COLORS.textTertiary }}>(optional)</Text>
            </Text>
            <TextInput
              value={requestDesc}
              onChangeText={setRequestDesc}
              placeholder="Anything that helps us understand the category."
              placeholderTextColor={COLORS.textTertiary}
              style={[styles.searchInput, { height: 90, textAlignVertical: 'top' }]}
              multiline
              maxLength={500}
            />

            {requestError ? <Text style={styles.modalError}>{requestError}</Text> : null}
            {requestInfo  ? <Text style={styles.modalInfo}>{requestInfo}</Text>   : null}

            <View style={{ height: SPACING.md }} />
            <PrimaryButton
              label={requestBusy ? 'Sending…' : 'Send request'}
              onPress={submitInterestRequest}
              loading={requestBusy}
              disabled={requestBusy}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Photo lightbox */}
      <PhotoLightbox photo={viewerPhoto} onClose={() => setViewerPhoto(null)} />
    </SafeAreaView>
  );
}

// ─── PoliticalSlider — pure-JS, no native module ──────────────────────────
// Supports iOS, Android, and web via PanResponder (react-native-web wraps
// mouse events automatically). Value range: -100 to 100.
const THUMB_R = 14;
function PoliticalSlider({ value, onChange, setScrollEnabled }) {
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const startXRef = useRef(0);

  useEffect(() => { trackWRef.current = trackW; }, [trackW]);

  const toPos = (v) => ((v ?? 0) + 100) / 200;       // -100→0, 0→0.5, 100→1
  const toVal = (pos) => Math.round(Math.max(0, Math.min(1, pos)) * 200 - 100);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (e) => {
        startXRef.current = e.nativeEvent.locationX ?? 0;
        setScrollEnabled?.(false);
        const w = trackWRef.current;
        if (!w) return;
        onChange(toVal((e.nativeEvent.locationX ?? 0) / w));
      },
      onPanResponderMove: (e) => {
        const w = trackWRef.current;
        if (!w) return;
        const x = e.nativeEvent.locationX ?? 0;
        onChange(toVal(x / w));
      },
      onPanResponderRelease: () => {
        setScrollEnabled?.(true);
      },
      onPanResponderTerminate: () => {
        setScrollEnabled?.(true);
      },
    })
  ).current;

  const v    = value ?? 0;
  const pos  = toPos(v);
  const isRight = v > 0;
  const fillColor = isRight ? COLORS.clay : COLORS.sage;
  const thumbLeft = trackW > 0 ? pos * trackW - THUMB_R : 0;

  const labelText = value === null || value === undefined
    ? 'Not set'
    : v === 0 ? 'Moderate (no match)'
    : v > 0   ? `Conservative  +${v}`
    : `Liberal  ${v}`;

  return (
    <View style={{ gap: 10 }}>
      {/* Row labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={sliderLabel}>Liberal</Text>
        <Text style={[sliderLabel, { color: COLORS.textTertiary }]}>Moderate</Text>
        <Text style={sliderLabel}>Conservative</Text>
      </View>

      {/* Track — full width touch target */}
      <View
        style={{ height: THUMB_R * 2, justifyContent: 'center', touchAction: 'none' }}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
      >
        {/* Gray base track */}
        <View style={{
          position: 'absolute', left: 0, right: 0,
          height: 5, borderRadius: 3,
          backgroundColor: COLORS.border,
        }} />

        {/* Colored fill from center toward thumb */}
        {trackW > 0 && v !== 0 && (
          <View style={{
            position: 'absolute',
            height: 5, borderRadius: 3,
            backgroundColor: fillColor,
            left:  v < 0 ? pos * trackW : trackW / 2,
            width: Math.abs(pos * trackW - trackW / 2),
          }} />
        )}

        {/* Center tick */}
        {trackW > 0 && (
          <View style={{
            position: 'absolute',
            left: trackW / 2 - 1,
            top: THUMB_R - 7,
            width: 2, height: 14,
            borderRadius: 1,
            backgroundColor: COLORS.textTertiary,
          }} />
        )}

        {/* Thumb */}
        {trackW > 0 && (
          <View style={{
            position: 'absolute',
            left: thumbLeft,
            top: 0,
            width: THUMB_R * 2, height: THUMB_R * 2,
            borderRadius: THUMB_R,
            backgroundColor: value === null ? COLORS.surfaceAlt : fillColor,
            borderWidth: 2.5, borderColor: COLORS.white,
            shadowColor: '#000',
            shadowOpacity: 0.15, shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }} />
        )}
      </View>

      {/* Current value label */}
      <Text style={{ fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' }}>
        {labelText}
      </Text>
    </View>
  );
}
const sliderLabel = { fontFamily: FONT.mono, fontSize: 10, letterSpacing: 0.8, color: COLORS.textSecondary };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  backBtn: {
    width: 40, height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    ...SHADOW.sm,
  },
  backArrow: { fontSize: 20, color: COLORS.text },
  navTitle: { fontFamily: FONT.serifItalic, fontSize: 22, color: COLORS.text },

  section: {
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    gap: SPACING.sm,
  },

  input: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
  },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  counter: { fontFamily: FONT.mono, fontSize: 10, color: COLORS.textTertiary, alignSelf: 'flex-end' },
  fieldHint: { fontFamily: FONT.body, fontSize: 12, color: COLORS.textTertiary, marginBottom: 8, lineHeight: 17 },

  // Hometown city rows
  hometownRowLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, marginTop: 10, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  hometownRow:  { flexDirection: 'row', gap: 8, marginBottom: 6 },
  hometownCity: { flex: 1 },
  hometownState: { width: 110 },

  // Address autocomplete
  hint:          { fontFamily: FONT.body, fontSize: 12, color: COLORS.textTertiary, marginTop: 6, marginBottom: 2 },
  hintConfirmed: { color: COLORS.sage },
  inputDropdownOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomColor: COLORS.borderLight },
  dropdown: {
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderTopWidth: 0, borderColor: COLORS.border,
    borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg,
    marginBottom: 4, overflow: 'hidden',
  },
  suggestionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  suggestionDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  suggestionText: { flex: 1, fontFamily: FONT.regular, fontSize: 14, color: COLORS.text, lineHeight: 20 },

  // City / State / ZIP row
  addressRow:      { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  addressColCity:  { flex: 1 },
  addressColState: { width: 64 },
  addressColZip:   { width: 80 },
  addressLabel:    { fontFamily: FONT.medium, fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 },

  // Binary card (personality)
  binaryRow:             { flexDirection: 'row', gap: 10 },
  binaryCard:            { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border, ...SHADOW.sm },
  binaryCardSelected:    { borderColor: COLORS.accent, backgroundColor: COLORS.surfaceAlt },
  binaryLabel:           { fontFamily: FONT.medium, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
  binaryLabelSelected:   { color: COLORS.text },
  binarySubLabel:        { fontFamily: FONT.body, fontSize: 11, color: COLORS.textTertiary, textAlign: 'center', marginTop: 3 },
  binarySubLabelSelected:{ color: COLORS.textSecondary },

  // Option grid
  optGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optCard: {
    width: '47.5%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  optCardSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.surfaceAlt },
  optIconWrap: {
    width: 40, height: 40,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  optIconWrapSelected: { backgroundColor: COLORS.sageBg },
  optLabel: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
  optLabelSelected: { color: COLORS.text },

  // Church
  churchList: { gap: 8 },
  churchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5, borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  churchRowSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.surfaceAlt },
  churchIcon: {
    width: 36, height: 36,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center', justifyContent: 'center',
  },
  churchInfo: { flex: 1 },
  churchName: { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.textSecondary },
  churchMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  check: {
    width: 24, height: 24,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.sage,
    alignItems: 'center', justifyContent: 'center',
  },

  footer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.lg : SPACING.sm,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },

  // Interest search input (reused by request modal)
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  emptyNote: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: SPACING.md,
  },

  // Slider clear + church toggle
  clearSlider: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 2,
  },
  clearSliderText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  churchToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  churchToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  churchToggleActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  churchToggleText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  churchToggleTextActive: {
    color: COLORS.white,
  },

  // Political lean picker
  sectionHint: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  politicalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  politicalChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  politicalChipActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  politicalChipText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  politicalChipTextActive: {
    color: COLORS.white,
  },

  // Request interest button
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  requestBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.2,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  modalTitle: {
    fontFamily: FONT.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  modalLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  modalError: {
    marginTop: SPACING.sm,
    fontFamily: FONT.regular,
    fontSize: 13,
    color: '#8A2D2D',
  },
  modalInfo: {
    marginTop: SPACING.sm,
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.text,
  },

  // Avatar
  avatarWrap: { position: 'relative', alignSelf: 'flex-start' },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
});

// ── Reel styles (defined outside main StyleSheet so they can reference
//    the REEL_* constants declared at module scope) ──────────────────────────
const reelStyles = StyleSheet.create({
  reelWrap: {
    position: 'relative',
    marginHorizontal: -SPACING.lg,
    overflow: 'hidden',
  },
  reelScrollContent: {
    paddingLeft: SPACING.lg,
    paddingRight: REEL_FADE,
    gap: REEL_GAP,
  },
  reelFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: REEL_FADE,
  },
  reelArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
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
  reelArrowLeft:  { left: 8 },
  reelArrowRight: { right: 24 },
  reelSlot: {
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
});
