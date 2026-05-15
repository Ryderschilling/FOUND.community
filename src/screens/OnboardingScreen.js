import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  SafeAreaView,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import {
  LIFE_STAGES,
  HAS_KIDS_STAGES,
  ACTIVITIES,
  FAMILY_VALUES,
  SCHOOL_TYPES,
  LOVE_LANGUAGES,
  COMMUNITY_GOALS,
} from '../data/mock';

// ─── Helpers ──────────────────────────────────────────────────────────────
// Parse "Nashville, TN" -> { city: 'Nashville', state: 'TN' }.
// Split on the LAST comma so multi-comma city names ("Washington, D.C.") still work.
function parseLocation(text) {
  if (!text || !text.trim()) return { city: null, state: null };
  const trimmed = text.trim();
  const idx = trimmed.lastIndexOf(',');
  if (idx < 0) return { city: trimmed, state: null };
  return {
    city:  trimmed.slice(0, idx).trim() || null,
    state: trimmed.slice(idx + 1).trim() || null,
  };
}

// ─── Step ID sequence ────────────────────────────────────────────────────────
// School-type is conditionally inserted based on life stage answer
const BASE_STEPS = ['life-stage', 'activities', 'location', 'family-values', 'love-language', 'personality', 'community-goals', 'church', 'reveal'];

function buildSteps(lifeStage) {
  const steps = [...BASE_STEPS];
  if (HAS_KIDS_STAGES.includes(lifeStage)) {
    // Insert school-type after family-values
    const idx = steps.indexOf('family-values');
    steps.splice(idx + 1, 0, 'school-type');
  }
  return steps;
}

// ─── Shared sub-components ───────────────────────────────────────────────────
function OptionCard({ item, selected, onPress }) {
  return (
    <Pressable
      style={[styles.optCard, selected && styles.optCardSelected]}
      onPress={onPress}
    >
      <View style={[styles.optIconWrap, selected && styles.optIconWrapSelected]}>
        <Ionicons
          name={item.icon}
          size={22}
          color={selected ? (item.iconColor ?? COLORS.accent) : COLORS.textSecondary}
        />
      </View>
      <Text style={[styles.optLabel, selected && styles.optLabelSelected]}>
        {item.label}
      </Text>
    </Pressable>
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

// ─── Step components ─────────────────────────────────────────────────────────
function StepLifeStage({ selection, onSelect }) {
  return (
    <>
      <Text style={styles.stepTitle}>What's your life stage?</Text>
      <Text style={styles.stepSub}>We'll find others who get where you're at.</Text>
      <View style={styles.optGrid}>
        {LIFE_STAGES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selection === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepActivities({ selections, onToggle }) {
  return (
    <>
      <Text style={styles.stepTitle}>What do you enjoy?</Text>
      <Text style={styles.stepSub}>Pick everything that fits — we'll find your people.</Text>
      <View style={styles.optGrid}>
        {ACTIVITIES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selections.includes(item.id)} onPress={() => onToggle(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepLocation({ value, onChange }) {
  return (
    <>
      <Text style={styles.stepTitle}>Where are you located?</Text>
      <Text style={styles.stepSub}>Helps us surface people nearby.</Text>
      <TextInput
        style={styles.textInput}
        placeholder="City, State (e.g. Nashville, TN)"
        placeholderTextColor={COLORS.textTertiary}
        value={value}
        onChangeText={onChange}
        autoCapitalize="words"
        returnKeyType="done"
      />
      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

function StepFamilyValues({ selections, onToggle }) {
  return (
    <>
      <Text style={styles.stepTitle}>What values matter in your home?</Text>
      <Text style={styles.stepSub}>Select all that apply. Skip if none fit.</Text>
      <View style={styles.optGrid}>
        {FAMILY_VALUES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selections.includes(item.id)} onPress={() => onToggle(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepSchoolType({ selection, onSelect }) {
  return (
    <>
      <Text style={styles.stepTitle}>What type of school are your kids in?</Text>
      <Text style={styles.stepSub}>Helps connect you with families in similar environments.</Text>
      <View style={styles.optGrid}>
        {SCHOOL_TYPES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selection === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </View>
      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

function StepLoveLanguage({ selection, onSelect }) {
  return (
    <>
      <Text style={styles.stepTitle}>What's your love language?</Text>
      <Text style={styles.stepSub}>Helps us match you with compatible people.</Text>
      <View style={styles.optGrid}>
        {LOVE_LANGUAGES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selection === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepPersonality({ initiator, onSelectInitiator, outgoing, onSelectOutgoing }) {
  return (
    <>
      <Text style={styles.stepTitle}>A little about your personality.</Text>
      <Text style={styles.stepSub}>Helps us match you with people who complement you.</Text>

      <Text style={styles.subQuestion}>Are you an initiator?</Text>
      <View style={styles.binaryRow}>
        <BinaryCard label="Yes" selected={initiator === true} onPress={() => onSelectInitiator(true)} />
        <BinaryCard label="Not Really" selected={initiator === false} onPress={() => onSelectInitiator(false)} />
      </View>

      <Text style={[styles.subQuestion, { marginTop: SPACING.xl }]}>How would you describe yourself?</Text>
      <View style={styles.binaryRow}>
        <BinaryCard
          label="Outgoing"
          subLabel="I'll talk to anybody!"
          selected={outgoing === true}
          onPress={() => onSelectOutgoing(true)}
        />
        <BinaryCard
          label="More Reserved"
          subLabel="Once I get to know you."
          selected={outgoing === false}
          onPress={() => onSelectOutgoing(false)}
        />
      </View>
    </>
  );
}

function StepCommunityGoals({ selections, onToggle }) {
  return (
    <>
      <Text style={styles.stepTitle}>What are you hoping to find?</Text>
      <Text style={styles.stepSub}>Pick everything that resonates.</Text>
      <View style={styles.optGrid}>
        {COMMUNITY_GOALS.map((item) => (
          <OptionCard key={item.id} item={item} selected={selections.includes(item.id)} onPress={() => onToggle(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepChurch({ selection, onSelect, churches, loading }) {
  const [query, setQuery] = useState('');
  const filtered = (churches ?? []).filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <Text style={styles.stepTitle}>Where do you worship?</Text>
      <Text style={styles.stepSub}>Optional — helps us connect you with your congregation.</Text>

      <TextInput
        style={styles.textInput}
        placeholder="Search for your church..."
        placeholderTextColor={COLORS.textTertiary}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />

      <Text style={styles.nearbyLabel}>Nearby Churches</Text>

      {loading ? (
        <View style={{ paddingVertical: SPACING.lg, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={[styles.optionalNote, { textAlign: 'left' }]}>
          {query ? 'No churches match that search.' : 'No churches loaded yet.'}
        </Text>
      ) : (
        <View style={styles.churchList}>
          {filtered.map((church) => {
            const meta = [church.city, church.state].filter(Boolean).join(', ');
            return (
              <Pressable
                key={church.id}
                style={[styles.churchRow, selection === church.id && styles.churchRowSelected]}
                onPress={() => onSelect(church.id === selection ? null : church.id)}
              >
                <View style={styles.churchIcon}>
                  <Ionicons name="business-outline" size={18} color={COLORS.sage} />
                </View>
                <View style={styles.churchInfo}>
                  <Text style={[styles.churchName, selection === church.id && { color: COLORS.text }]}>
                    {church.name}
                  </Text>
                  {meta ? <Text style={styles.churchMeta}>{meta}</Text> : null}
                </View>
                {selection === church.id && (
                  <View style={styles.check}>
                    <Ionicons name="checkmark" size={14} color={COLORS.white} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

function StepMatchReveal({ onFinish, busy }) {
  return (
    <View style={styles.revealWrap}>
      <View style={styles.revealStat}>
        <Text style={styles.revealNumber}>14</Text>
        <Text style={styles.revealUnit}>people nearby</Text>
      </View>
      <Text style={styles.revealTitle}>You're all set.</Text>
      <Text style={styles.revealBody}>
        We found people near you who share your interests and life stage. Go find your community.
      </Text>
      <PrimaryButton
        label={busy ? 'Saving…' : 'See My Matches'}
        onPress={onFinish}
        loading={busy}
        disabled={busy}
        style={styles.revealBtn}
      />
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function OnboardingScreen({ navigation }) {
  const { refreshProfile } = useAuth();

  const [step, setStep]                     = useState(1);
  const [lifeStage, setLifeStage]           = useState(null);
  const [activities, setActivities]         = useState([]);
  const [location, setLocation]             = useState('');
  const [familyValues, setFamilyValues]     = useState([]);
  const [schoolType, setSchoolType]         = useState(null);
  const [loveLanguage, setLoveLanguage]     = useState(null);
  const [initiator, setInitiator]           = useState(null);
  const [outgoing, setOutgoing]             = useState(null);
  const [communityGoals, setCommunityGoals] = useState([]);
  const [church, setChurch]                 = useState(null);

  // Real churches from Supabase (replaces NEARBY_CHURCHES mock)
  const [churches, setChurches]             = useState([]);
  const [churchesLoading, setChurchesLoading] = useState(true);

  // Submit state
  const [busy, setBusy] = useState(false);

  // Fetch churches once on mount. Cheap query — no pagination yet, we have ~4 rows.
  // When the church list gets large, add a search-as-you-type RPC with PostGIS distance.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('churches')
        .select('id, name, city, state')
        .order('name', { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn('[onboarding] churches fetch failed', error.message);
        setChurches([]);
      } else {
        setChurches(data ?? []);
      }
      setChurchesLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Recompute step list whenever lifeStage changes
  const steps = useMemo(() => buildSteps(lifeStage), [lifeStage]);
  const totalSteps = steps.length;
  const currentStepId = steps[step - 1];

  const toggle = (setter) => (id) =>
    setter((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  const canContinue = () => {
    switch (currentStepId) {
      case 'life-stage':      return lifeStage !== null;
      case 'activities':      return activities.length >= 1;
      case 'location':        return true; // optional
      case 'family-values':   return true; // optional
      case 'school-type':     return true; // optional
      case 'love-language':   return loveLanguage !== null;
      case 'personality':     return initiator !== null && outgoing !== null;
      case 'community-goals': return communityGoals.length >= 1;
      case 'church':          return true; // optional
      default:                return true;
    }
  };

  const handleContinue = () => {
    if (step < totalSteps) setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => s - 1);
    else navigation.goBack();
  };

  // Submit: write profile to Supabase via the complete_onboarding RPC.
  // The RPC sets onboarding_complete=true; after refreshProfile() the root
  // navigator (in src/navigation/index.js) will auto-route to the Main stack.
  async function handleFinish() {
    if (busy) return;
    setBusy(true);
    try {
      const { city, state } = parseLocation(location);
      const { error } = await supabase.rpc('complete_onboarding', {
        p_life_stage:    lifeStage,
        p_school_type:   schoolType,
        p_love_language: loveLanguage,
        p_church_id:     church,
        p_city:          city,
        p_state:         state,
        p_is_initiator:  initiator,
        p_is_outgoing:   outgoing,
        p_activities:    activities,
        p_goals:         communityGoals,
        p_values:        familyValues,
      });
      if (error) throw error;
      await refreshProfile();
      // No navigation.replace needed — AppNavigator swaps stacks on onboarding_complete.
    } catch (e) {
      Alert.alert('Could not save your profile', e?.message ?? 'Unknown error. Try again.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.stepCounter}>{step} / {totalSteps}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
      </View>

      {/* Step content */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {currentStepId === 'life-stage' && (
          <StepLifeStage selection={lifeStage} onSelect={setLifeStage} />
        )}
        {currentStepId === 'activities' && (
          <StepActivities selections={activities} onToggle={toggle(setActivities)} />
        )}
        {currentStepId === 'location' && (
          <StepLocation value={location} onChange={setLocation} />
        )}
        {currentStepId === 'family-values' && (
          <StepFamilyValues selections={familyValues} onToggle={toggle(setFamilyValues)} />
        )}
        {currentStepId === 'school-type' && (
          <StepSchoolType selection={schoolType} onSelect={setSchoolType} />
        )}
        {currentStepId === 'love-language' && (
          <StepLoveLanguage selection={loveLanguage} onSelect={setLoveLanguage} />
        )}
        {currentStepId === 'personality' && (
          <StepPersonality
            initiator={initiator}
            onSelectInitiator={setInitiator}
            outgoing={outgoing}
            onSelectOutgoing={setOutgoing}
          />
        )}
        {currentStepId === 'community-goals' && (
          <StepCommunityGoals selections={communityGoals} onToggle={toggle(setCommunityGoals)} />
        )}
        {currentStepId === 'church' && (
          <StepChurch
            selection={church}
            onSelect={setChurch}
            churches={churches}
            loading={churchesLoading}
          />
        )}
        {currentStepId === 'reveal' && (
          <StepMatchReveal onFinish={handleFinish} busy={busy} />
        )}
      </ScrollView>

      {/* Footer CTA */}
      {currentStepId !== 'reveal' && (
        <View style={styles.footer}>
          <PrimaryButton
            label="Continue"
            onPress={handleContinue}
            disabled={!canContinue()}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 20, color: COLORS.text },
  stepCounter: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.textTertiary,
  },

  progressTrack: {
    height: 2,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.lg,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.full,
  },

  body: { flex: 1 },
  bodyContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },

  stepTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 26,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 33,
    marginBottom: SPACING.sm,
  },
  stepSub: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.lg,
  },
  subQuestion: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  optionalNote: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.md,
  },

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
  optCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.surfaceAlt,
  },
  optIconWrap: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Binary cards
  binaryRow: { flexDirection: 'row', gap: 10 },
  binaryCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 4,
    ...SHADOW.sm,
  },
  binaryCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.surfaceAlt,
  },
  binaryLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  binaryLabelSelected: { color: COLORS.text },
  binarySubLabel: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    lineHeight: 16,
  },
  binarySubLabelSelected: { color: COLORS.textSecondary },

  // Text input
  textInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },

  // Church step
  nearbyLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  churchList: { gap: 8 },
  churchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  churchRowSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.surfaceAlt },
  churchIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  churchInfo: { flex: 1 },
  churchName: { fontFamily: FONT.semiBold, fontSize: 14, color: COLORS.textSecondary },
  churchMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Reveal step
  revealWrap: { alignItems: 'center', paddingTop: SPACING['2xl'], gap: SPACING.md },
  revealStat: { alignItems: 'center', marginBottom: SPACING.sm },
  revealNumber: {
    fontFamily: FONT.serifItalic,
    fontSize: 80,
    color: COLORS.text,
    lineHeight: 88,
    letterSpacing: -2,
  },
  revealUnit: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: -8,
  },
  revealTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 32,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  revealBody: {
    fontFamily: FONT.regular,
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 25,
    paddingHorizontal: SPACING.md,
  },
  revealBtn: { marginTop: SPACING.sm, alignSelf: 'stretch' },

  // Footer
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.sm,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
});
