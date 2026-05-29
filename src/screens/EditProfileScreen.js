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

import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton, SectionHeader } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastProvider';
import { geocode } from '../lib/geocode';
import { firstViolation } from '../lib/contentFilter';
import ChurchPicker from '../components/ChurchPicker';

function parseLocation(text) {
  if (!text || !text.trim()) return { city: '', state: '' };
  const trimmed = text.trim();
  const idx = trimmed.lastIndexOf(',');
  if (idx < 0) return { city: trimmed, state: '' };
  return {
    city:  trimmed.slice(0, idx).trim(),
    state: trimmed.slice(idx + 1).trim(),
  };
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

  // Form state — initialized from current profile once loaded.
  const [fullName, setFullName]       = useState('');
  const [bio, setBio]                 = useState('');
  const [hometown, setHometown]       = useState('');
  const [locationText, setLocationText] = useState('');
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

  const [politicalLean, setPoliticalLean] = useState(null); // null | integer -100..100
  const [saving, setSaving]           = useState(false);

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
      const [lsR, actR, goalR, profR] = await Promise.all([
        supabase.from('life_stages').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('activities').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('community_goals').select('id,label,icon,icon_color').order('sort_order'),
        user
          ? supabase.from('profiles')
              .select('full_name,bio,hometown,city,state,life_stage_id,church_id,is_home_church,political_lean,church:churches(name),profile_activities(activity_id),profile_goals(goal_id)')
              .eq('id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setLifeStages(lsR.data ?? []);
      setAllActivities(actR.data ?? []);
      setAllGoals(goalR.data ?? []);
      const p = profR.data;
      if (p) {
        setFullName(p.full_name ?? '');
        setBio(p.bio ?? '');
        setHometown(p.hometown ?? '');
        setLocationText([p.city, p.state].filter(Boolean).join(', '));
        setLifeStage(p.life_stage_id ?? null);
        setProfileChurchId(p.church_id ?? null);
        setProfileIsHome(p.is_home_church ?? false);
        setProfileChurchName(p.church?.name ?? null);
        setActivities((p.profile_activities ?? []).map((r) => r.activity_id));
        setGoals((p.profile_goals ?? []).map((r) => r.goal_id));
        setPoliticalLean(p.political_lean ?? null);
      } else if (profile) {
        setFullName(profile.full_name ?? '');
      }
      setTaxLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, profile]);

  const toggle = (setter) => (id) =>
    setter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSave = useCallback(async () => {
    if (saving) return;

    const violation = firstViolation([
      { text: fullName, label: 'name' },
      { text: bio,      label: 'bio' },
      { text: hometown, label: 'hometown' },
    ]);
    if (!violation.ok) {
      toast({ title: 'Check your wording', message: violation.message, type: 'info' });
      return;
    }

    setSaving(true);
    const { city, state } = parseLocation(locationText);

    // 1) Persist core profile fields
    const { error } = await supabase.rpc('update_profile', {
      p_full_name:  fullName.trim() || null,
      p_bio:        bio.trim() || null,
      p_hometown:   hometown.trim() || null,
      p_city:       city || null,
      p_state:      state || null,
      p_life_stage: lifeStage,
      p_church_id:  null,                  // structured directory not live yet
      p_activities: activities,            // pass array → REPLACE
      p_goals:      goals,
    });
    if (error) {
      setSaving(false);
      toast({ title: 'Could not save', message: error.message, type: 'error' });
      return;
    }

    // Save political_lean separately (not in update_profile RPC)
    if (politicalLean !== null) {
      await supabase
        .from('profiles')
        .update({ political_lean: politicalLean })
        .eq('id', user.id);
    } else {
      // Explicitly clear it if the user deselected
      await supabase
        .from('profiles')
        .update({ political_lean: null })
        .eq('id', user.id);
    }

    // Church is committed immediately by ChurchPicker — nothing to do here.

    // 2) Geocode City, State → lat/lng → PostGIS point.
    //    Failures here are non-fatal: profile text fields still saved,
    //    we just log and move on. Worst case = no proximity score.
    if (locationText.trim()) {
      const { lat, lng, error: geoErr } = await geocode(locationText);
      if (geoErr) {
        console.warn('[edit-profile] geocode failed', geoErr.message);
      } else if (lat != null && lng != null) {
        const { error: locErr } = await supabase.rpc('set_profile_location', {
          p_lat: lat,
          p_lng: lng,
        });
        if (locErr) console.warn('[edit-profile] set location failed', locErr.message);
      }
    } else {
      // Empty location field → clear the PostGIS point too
      await supabase.rpc('set_profile_location', { p_lat: null, p_lng: null });
    }

    await refreshProfile();
    setSaving(false);
    navigation?.goBack();
  }, [saving, fullName, bio, hometown, locationText, lifeStage, activities, goals, refreshProfile, navigation]);

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
        keyboardShouldPersistTaps="handled"
      >
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
          <SectionHeader label="Where you're from" />
          <TextInput
            style={styles.input}
            value={hometown}
            onChangeText={setHometown}
            placeholder="e.g. Nashville, TN"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="words"
            maxLength={80}
          />
        </View>

        {/* Location */}
        <View style={styles.section}>
          <SectionHeader label="Location" />
          <TextInput
            style={styles.input}
            value={locationText}
            onChangeText={setLocationText}
            placeholder="City, State"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="words"
          />
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

        {/* Political Lean — optional */}
        {(() => {
          const POLITICAL_OPTIONS = [
            { label: 'Conservative',    value: 80  },
            { label: 'Center-Right',    value: 40  },
            { label: 'Moderate',        value: 0   },
            { label: 'Center-Left',     value: -40 },
            { label: 'Liberal',         value: -80 },
          ];
          return (
            <View style={styles.section}>
              <SectionHeader label="Political Views  ·  Optional" />
              <Text style={styles.sectionHint}>
                Only used to find people with similar views. Never shown publicly.
              </Text>
              <View style={styles.politicalRow}>
                {POLITICAL_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[
                      styles.politicalChip,
                      politicalLean === opt.value && styles.politicalChipActive,
                    ]}
                    onPress={() => setPoliticalLean(
                      politicalLean === opt.value ? null : opt.value
                    )}
                  >
                    <Text style={[
                      styles.politicalChipText,
                      politicalLean === opt.value && styles.politicalChipTextActive,
                    ]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })()}

        {/* Church — search + request via ChurchPicker */}
        <View style={styles.section}>
          <SectionHeader label="Church" />
          <ChurchPicker
            churchId={profileChurchId}
            isHomeChurch={profileIsHome}
            churchName={profileChurchName}
            onSaved={({ churchId, isHomeChurch }) => {
              setProfileChurchId(churchId);
              setProfileIsHome(isHomeChurch);
            }}
          />
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
    </SafeAreaView>
  );
}

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
});
