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
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton, SectionHeader } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { geocode } from '../lib/geocode';
import { firstViolation } from '../lib/contentFilter';

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

  // Form state — initialized from current profile once loaded.
  const [fullName, setFullName]       = useState('');
  const [bio, setBio]                 = useState('');
  const [hometown, setHometown]       = useState('');
  const [locationText, setLocationText] = useState('');
  const [lifeStage, setLifeStage]     = useState(null);
  const [activities, setActivities]   = useState([]);    // array of activity ids
  const [goals, setGoals]             = useState([]);
  const [church, setChurch]           = useState(null);

  // Taxonomy + churches
  const [lifeStages, setLifeStages]   = useState([]);
  const [allActivities, setAllActivities] = useState([]);
  const [allGoals, setAllGoals]       = useState([]);
  const [churches, setChurches]       = useState([]);
  const [taxLoading, setTaxLoading]   = useState(true);

  const [saving, setSaving]           = useState(false);

  // Load taxonomies + churches + own profile detail (for activities/goals).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lsR, actR, goalR, chR, profR] = await Promise.all([
        supabase.from('life_stages').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('activities').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('community_goals').select('id,label,icon,icon_color').order('sort_order'),
        supabase.from('churches').select('id,name,city,state').order('name').limit(200),
        user
          ? supabase.from('profiles')
              .select('full_name,bio,hometown,city,state,life_stage_id,church_id,profile_activities(activity_id),profile_goals(goal_id)')
              .eq('id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setLifeStages(lsR.data ?? []);
      setAllActivities(actR.data ?? []);
      setAllGoals(goalR.data ?? []);
      setChurches(chR.data ?? []);
      const p = profR.data;
      if (p) {
        setFullName(p.full_name ?? '');
        setBio(p.bio ?? '');
        setHometown(p.hometown ?? '');
        setLocationText([p.city, p.state].filter(Boolean).join(', '));
        setLifeStage(p.life_stage_id ?? null);
        setChurch(p.church_id ?? null);
        setActivities((p.profile_activities ?? []).map((r) => r.activity_id));
        setGoals((p.profile_goals ?? []).map((r) => r.goal_id));
      } else if (profile) {
        setFullName(profile.full_name ?? '');
      }
      setTaxLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, profile]);

  const toggle = (setter) => (id) =>
    setter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const churchList = useMemo(() => churches, [churches]);

  const handleSave = useCallback(async () => {
    if (saving) return;

    const violation = firstViolation([
      { text: fullName, label: 'name' },
      { text: bio,      label: 'bio' },
      { text: hometown, label: 'hometown' },
    ]);
    if (!violation.ok) {
      Alert.alert('Check your wording', violation.message);
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
      p_church_id:  church,
      p_activities: activities,   // pass array → REPLACE
      p_goals:      goals,
    });
    if (error) {
      setSaving(false);
      Alert.alert('Could not save', error.message);
      return;
    }

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
  }, [saving, fullName, bio, hometown, locationText, lifeStage, church, activities, goals, refreshProfile, navigation]);

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
          <View style={styles.optGrid}>
            {allActivities.map((item) => (
              <OptionCard
                key={item.id}
                item={item}
                selected={activities.includes(item.id)}
                onPress={() => toggle(setActivities)(item.id)}
              />
            ))}
          </View>
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

        {/* Church */}
        <View style={styles.section}>
          <SectionHeader label="Church" />
          <View style={styles.churchList}>
            {churchList.map((c) => {
              const meta = [c.city, c.state].filter(Boolean).join(', ');
              const selected = church === c.id;
              return (
                <Pressable
                  key={c.id}
                  style={[styles.churchRow, selected && styles.churchRowSelected]}
                  onPress={() => setChurch(selected ? null : c.id)}
                >
                  <View style={styles.churchIcon}>
                    <Ionicons name="business-outline" size={18} color={COLORS.sage} />
                  </View>
                  <View style={styles.churchInfo}>
                    <Text style={[styles.churchName, selected && { color: COLORS.text }]}>{c.name}</Text>
                    {meta ? <Text style={styles.churchMeta}>{meta}</Text> : null}
                  </View>
                  {selected ? (
                    <View style={styles.check}>
                      <Ionicons name="checkmark" size={14} color={COLORS.white} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
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
});
