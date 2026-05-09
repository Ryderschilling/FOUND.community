import React, { useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from '../components/Atoms';
import { LIFE_STAGES, INTERESTS, NEARBY_CHURCHES } from '../data/mock';

const TOTAL_STEPS = 4;

function OptionCard({ item, selected, onPress }) {
  return (
    <Pressable
      style={[styles.optCard, selected && styles.optCardSelected]}
      onPress={onPress}
    >
      <View style={[styles.optIconWrap, selected && styles.optIconWrapSelected]}>
        <Ionicons name={item.icon} size={24} color={selected ? (item.iconColor ?? COLORS.accent) : COLORS.textSecondary} />
      </View>
      <Text style={[styles.optLabel, selected && styles.optLabelSelected]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

function StepLifeStage({ selection, onSelect }) {
  return (
    <>
      <Text style={styles.stepTitle}>What's your life stage right now?</Text>
      <Text style={styles.stepSub}>We'll find others who get where you're at.</Text>
      <View style={styles.optGrid}>
        {LIFE_STAGES.map((item) => (
          <OptionCard key={item.id} item={item} selected={selection === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepInterests({ selections, onToggle }) {
  return (
    <>
      <Text style={styles.stepTitle}>What are you into?</Text>
      <Text style={styles.stepSub}>Pick everything that fits — we'll find your people.</Text>
      <View style={styles.optGrid}>
        {INTERESTS.map((item) => (
          <OptionCard key={item.id} item={item} selected={selections.includes(item.id)} onPress={() => onToggle(item.id)} />
        ))}
      </View>
    </>
  );
}

function StepChurch({ selection, onSelect }) {
  const [query, setQuery] = useState('');
  const filtered = NEARBY_CHURCHES.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <Text style={styles.stepTitle}>Where do you worship?</Text>
      <Text style={styles.stepSub}>Optional — helps us connect you with your congregation.</Text>

      <TextInput
        style={styles.searchInput}
        placeholder="Search for your church..."
        placeholderTextColor={COLORS.textTertiary}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
      />

      <Text style={styles.nearbyLabel}>Nearby Churches</Text>

      <View style={styles.churchList}>
        {filtered.map((church) => (
          <Pressable
            key={church.id}
            style={[styles.churchRow, selection === church.id && styles.churchRowSelected]}
            onPress={() => onSelect(church.id)}
          >
            <View style={styles.churchIcon}>
              <Ionicons name="business-outline" size={18} color={COLORS.sage} />
            </View>
            <View style={styles.churchInfo}>
              <Text style={[styles.churchName, selection === church.id && { color: COLORS.text }]}>
                {church.name}
              </Text>
              <Text style={styles.churchMeta}>{church.distance} away · {church.members} members</Text>
            </View>
            {selection === church.id && (
              <View style={styles.check}>
                <Ionicons name="checkmark" size={14} color={COLORS.white} />
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </>
  );
}

function StepMatchReveal({ onFinish }) {
  return (
    <View style={styles.revealWrap}>
      {/* Big serif stat */}
      <View style={styles.revealStat}>
        <Text style={styles.revealNumber}>14</Text>
        <Text style={styles.revealUnit}>people nearby</Text>
      </View>

      <Text style={styles.revealTitle}>You're all set.</Text>
      <Text style={styles.revealBody}>
        We found people near you who share your interests and life stage. Go find your community.
      </Text>

      <PrimaryButton label="See My Matches" onPress={onFinish} style={styles.revealBtn} />
    </View>
  );
}

export default function OnboardingScreen({ navigation }) {
  const [step, setStep] = useState(1);
  const [lifeStage, setLifeStage] = useState(null);
  const [interests, setInterests] = useState([]);
  const [church, setChurch] = useState(null);

  const canContinue = () => {
    if (step === 1) return lifeStage !== null;
    if (step === 2) return interests.length >= 1;
    return true;
  };

  const handleContinue = () => {
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const handleFinish = () => navigation.replace('Main');

  const toggleInterest = (id) =>
    setInterests((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => step > 1 ? setStep((s) => s - 1) : navigation.goBack()}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.stepCounter}>{step} / {TOTAL_STEPS}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
      </View>

      {/* Step content */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        {step === 1 && <StepLifeStage selection={lifeStage} onSelect={setLifeStage} />}
        {step === 2 && <StepInterests selections={interests} onToggle={toggleInterest} />}
        {step === 3 && <StepChurch selection={church} onSelect={setChurch} />}
        {step === 4 && <StepMatchReveal onFinish={handleFinish} />}
      </ScrollView>

      {/* Footer CTA */}
      {step < 4 && (
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
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: { fontSize: 20, color: COLORS.text },
  stepCounter: { fontFamily: FONT.mono, fontSize: 11, letterSpacing: 1, color: COLORS.textTertiary },

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
    width: 48,
    height: 48,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optIconWrapSelected: { backgroundColor: COLORS.sageBg },
  optLabel: { fontFamily: FONT.medium, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 18 },
  optLabelSelected: { color: COLORS.text },

  searchInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 13,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  nearbyLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
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

  footer: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.sm,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
});
