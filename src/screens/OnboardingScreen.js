import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton } from '../components/Atoms';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { markTutorialPending } from '../lib/tutorial';
import ChurchPicker from '../components/ChurchPicker';
import {
  LIFE_STAGES,
  HAS_KIDS_STAGES,
  FAMILY_VALUES,
  SCHOOL_TYPES,
  LOVE_LANGUAGES,
  COMMUNITY_GOALS,
  DENOMINATIONS,
} from '../data/mock';

// ─── Step ID sequence ────────────────────────────────────────────────────────
// School-type is conditionally inserted based on life stage answer.
// Location is intentionally NOT here — it's captured once at signup (from the
// ZIP) and never asked again.
const BASE_STEPS = ['life-stage', 'activities', 'family-values', 'love-language', 'personality', 'political-lean', 'community-goals', 'church', 'denomination', 'reveal'];

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

function StepActivities({ selections, onToggle, activities, loading, onOpenRequest }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? activities
    : activities.filter((a) => a.label.toLowerCase().includes(q));

  return (
    <>
      <Text style={styles.stepTitle}>What do you enjoy?</Text>
      <Text style={styles.stepSub}>Pick everything that fits — we'll find your people.</Text>

      <TextInput
        style={styles.textInput}
        placeholder="Search interests..."
        placeholderTextColor={COLORS.textTertiary}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {loading ? (
        <View style={{ paddingVertical: SPACING.lg, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      ) : filtered.length === 0 ? (
        <Text style={[styles.optionalNote, { textAlign: 'left' }]}>
          No interests match "{query}". Don't see yours? Request it below.
        </Text>
      ) : (
        <View style={styles.optGrid}>
          {filtered.map((item) => (
            <OptionCard
              key={item.id}
              item={item}
              selected={selections.includes(item.id)}
              onPress={() => onToggle(item.id)}
            />
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.requestBtn} onPress={onOpenRequest} activeOpacity={0.8}>
        <Ionicons name="add-circle-outline" size={18} color={COLORS.text} />
        <Text style={styles.requestBtnText}>Request an interest</Text>
      </TouchableOpacity>
    </>
  );
}

// ─── Interest Request Modal ──────────────────────────────────────────────────
// Calls the request_interest RPC. Ryder reviews the queue in Supabase and
// approves rows into `activities` manually.
function InterestRequestModal({ visible, onClose }) {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy]               = useState(false);
  const [errorMsg, setErrorMsg]       = useState(null);
  const [sentMsg, setSentMsg]         = useState(null);

  function handleClose() {
    if (busy) return;
    setName('');
    setDescription('');
    setErrorMsg(null);
    setSentMsg(null);
    onClose();
  }

  async function handleSubmit() {
    setErrorMsg(null);
    setSentMsg(null);
    const n = name.trim();
    if (!n) { setErrorMsg('Please enter an interest name.'); return; }
    if (n.length > 80) { setErrorMsg('Name is too long (max 80 characters).'); return; }
    if (description.trim().length > 500) {
      setErrorMsg('Description is too long (max 500 characters).'); return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.rpc('request_interest', {
        p_name: n,
        p_description: description.trim() || null,
      });
      if (error) throw error;
      setSentMsg("Thanks! We'll review your suggestion and add it soon.");
      setName('');
      setDescription('');
    } catch (e) {
      setErrorMsg(e?.message ?? 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Request an interest</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalLabel}>Interest name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Disc Golf"
            placeholderTextColor={COLORS.textTertiary}
            style={styles.textInput}
            autoCapitalize="words"
            maxLength={80}
          />

          <Text style={[styles.modalLabel, { marginTop: SPACING.md }]}>
            Description <Text style={{ color: COLORS.textTertiary }}>(optional)</Text>
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Anything that helps us understand the category."
            placeholderTextColor={COLORS.textTertiary}
            style={[styles.textInput, { height: 90, textAlignVertical: 'top' }]}
            multiline
            maxLength={500}
          />

          {errorMsg ? <Text style={styles.modalError}>{errorMsg}</Text> : null}
          {sentMsg  ? <Text style={styles.modalInfo}>{sentMsg}</Text>   : null}

          <View style={{ height: SPACING.md }} />
          <PrimaryButton
            label={busy ? 'Sending…' : 'Send request'}
            onPress={handleSubmit}
            loading={busy}
            disabled={busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

// ─── Political Lean Step ─────────────────────────────────────────────────────
// Drag slider: -100 (far left) → 100 (far right). NULL = skipped (optional).
// Dot starts at center. Dragging left fills track blue; dragging right fills red.
// Intensity of color increases the further you drag.

const POL_LEFT  = '#3B82F6'; // blue
const POL_RIGHT = '#EF4444'; // red

function StepPoliticalLean({ value, onChange }) {
  const [trackHalf, setTrackHalf] = useState(0);
  const [displayValue, setDisplayValue] = useState(value ?? null);

  const trackHalfRef = useRef(0);
  const liveValueRef = useRef(value ?? 0);
  const startPxRef   = useRef(0);
  const posAnim      = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: () => {
        // Capture where the drag starts (in pixels from center)
        startPxRef.current = (liveValueRef.current / 100) * trackHalfRef.current;
      },
      onPanResponderMove: (_, g) => {
        const half = trackHalfRef.current;
        if (!half) return;
        const raw = Math.max(-half, Math.min(half, startPxRef.current + g.dx));
        posAnim.setValue(raw);
        const v = Math.round((raw / half) * 100);
        liveValueRef.current = v;
        setDisplayValue(v);
        onChange(v);
      },
      onPanResponderRelease:  () => {},
      onPanResponderTerminate: () => {},
    })
  ).current;

  const onTrackLayout = useCallback((e) => {
    const half = e.nativeEvent.layout.width / 2;
    trackHalfRef.current = half;
    setTrackHalf(half);
    posAnim.setValue((liveValueRef.current / 100) * half);
  }, [posAnim]);

  // Derived values — recomputed on every setState from drag
  const pct    = (displayValue ?? 0) / 100; // -1..1
  const absPct = Math.abs(pct);
  const isLeft = pct < 0;
  const hasVal = displayValue !== null;

  const label = !hasVal
    ? 'Drag to set your lean'
    : absPct < 0.12
      ? 'Centrist / Moderate'
      : isLeft
        ? (absPct >= 0.65 ? 'Far Left'  : 'Lean Left')
        : (absPct >= 0.65 ? 'Far Right' : 'Lean Right');

  // Fill: colored strip from center → dot
  const fillPx    = trackHalf > 0 ? absPct * trackHalf : 0;
  const fillAlpha = (0.35 + absPct * 0.65).toFixed(2);
  const fillColor = isLeft
    ? `rgba(59,130,246,${fillAlpha})`
    : `rgba(239,68,68,${fillAlpha})`;

  // Dot and label colors
  const dotBg      = !hasVal ? COLORS.border : absPct < 0.08 ? '#1A1A1A' : isLeft ? POL_LEFT : POL_RIGHT;
  const labelColor = !hasVal ? COLORS.textTertiary : absPct < 0.12 ? COLORS.text : isLeft ? POL_LEFT : POL_RIGHT;

  return (
    <>
      <Text style={styles.stepTitle}>Which way do you lean politically?</Text>
      <Text style={styles.stepSub}>
        Your answer is private — only visible when you connect with someone in this area.
      </Text>

      <View style={politicalStyles.container}>
        {/* Track row */}
        <View style={politicalStyles.track} onLayout={onTrackLayout}>
          {/* Gray background bar */}
          <View style={politicalStyles.trackBg} />

          {/* Colored fill from center toward dot */}
          {hasVal && fillPx > 0 && (
            <View
              style={[
                politicalStyles.fill,
                {
                  width: fillPx,
                  left: isLeft ? trackHalf - fillPx : trackHalf,
                  backgroundColor: fillColor,
                },
              ]}
            />
          )}

          {/* Center tick mark */}
          <View style={politicalStyles.centerTick} />

          {/* Draggable dot — centered, moves via translateX */}
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              politicalStyles.dot,
              {
                left: trackHalf - 14,   // 14 = half dot width
                backgroundColor: dotBg,
                transform: [{ translateX: posAnim }],
              },
            ]}
          />
        </View>

        {/* Left / Right end labels */}
        <View style={politicalStyles.endLabels}>
          <Text style={[
            politicalStyles.endLabel,
            hasVal && isLeft && absPct > 0.08 && { color: POL_LEFT, fontFamily: FONT.semiBold },
          ]}>
            ← Left
          </Text>
          <Text style={[
            politicalStyles.endLabel,
            hasVal && !isLeft && absPct > 0.08 && { color: POL_RIGHT, fontFamily: FONT.semiBold },
          ]}>
            Right →
          </Text>
        </View>

        {/* Dynamic value callout */}
        <View style={politicalStyles.callout}>
          <Text style={[politicalStyles.calloutText, { color: labelColor }]}>
            {label}
          </Text>
        </View>
      </View>

      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

const politicalStyles = StyleSheet.create({
  container: {
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
  },
  track: {
    height: 44,                  // tall hit area; visual bar is inside
    justifyContent: 'center',
    marginHorizontal: SPACING.md,
    position: 'relative',
  },
  trackBg: {
    position: 'absolute',
    left: 0, right: 0,
    height: 5,
    backgroundColor: COLORS.border,
    borderRadius: 3,
  },
  fill: {
    position: 'absolute',
    height: 5,
    borderRadius: 3,
  },
  centerTick: {
    position: 'absolute',
    width: 2,
    height: 16,
    backgroundColor: COLORS.textTertiary,
    borderRadius: 1,
    left: '50%',
    marginLeft: -1,
    top: '50%',
    marginTop: -8,
  },
  dot: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    top: '50%',
    marginTop: -14,
    ...SHADOW.sm,
  },
  endLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
  },
  endLabel: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  callout: {
    alignSelf: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.lg,
    minWidth: 170,
  },
  calloutText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    textAlign: 'center',
  },
});

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

function StepDenomination({ selection, onSelect }) {
  return (
    <>
      <Text style={styles.stepTitle}>What's your church background?</Text>
      <Text style={styles.stepSub}>
        Helps us connect you with people from similar traditions.
      </Text>
      <View style={styles.optGrid}>
        {DENOMINATIONS.map((item) => (
          <OptionCard
            key={item.id}
            item={item}
            selected={selection === item.id}
            onPress={() => onSelect(item.id)}
          />
        ))}
      </View>
      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

// Church step — ChurchPicker handles search, home-church, and requests.
// Commits to DB immediately; onboarding just passes p_church_id: null to
// complete_onboarding (coalesce preserves whatever ChurchPicker already set).
function StepChurch() {
  return (
    <>
      <Text style={styles.stepTitle}>Your church community</Text>
      <Text style={styles.stepSub}>Optional — helps us connect you with your congregation.</Text>
      <View style={{ marginTop: SPACING.md }}>
        <ChurchPicker />
      </View>
      <Text style={styles.optionalNote}>Optional — you can skip this step.</Text>
    </>
  );
}

function StepMatchReveal({ onFinish, busy }) {
  // Entrance: ring scales in → check pops → title/body/button stagger up.
  // Background: three nested rings pulse slowly to add ambient motion.
  const ringScale  = useRef(new Animated.Value(0.2)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const titleY     = useRef(new Animated.Value(16)).current;
  const titleOp    = useRef(new Animated.Value(0)).current;
  const bodyY      = useRef(new Animated.Value(14)).current;
  const bodyOp     = useRef(new Animated.Value(0)).current;
  const btnY       = useRef(new Animated.Value(14)).current;
  const btnOp      = useRef(new Animated.Value(0)).current;

  // Ambient pulse rings (run on loop)
  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;
  const pulseC = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(ringScale, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringOpacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
      Animated.spring(checkScale, {
        toValue: 1,
        tension: 180,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.stagger(110, [
        Animated.parallel([
          Animated.timing(titleOp, { toValue: 1, duration: 360, useNativeDriver: true }),
          Animated.timing(titleY,  { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(bodyOp, { toValue: 1, duration: 360, useNativeDriver: true }),
          Animated.timing(bodyY,  { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(btnOp, { toValue: 1, duration: 360, useNativeDriver: true }),
          Animated.timing(btnY,  { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]),
    ]).start();

    const makePulse = (val, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );

    const p1 = makePulse(pulseA, 200);
    const p2 = makePulse(pulseB, 900);
    const p3 = makePulse(pulseC, 1600);
    p1.start(); p2.start(); p3.start();
    return () => { p1.stop(); p2.stop(); p3.stop(); };
  }, []);

  const pulseStyle = (val) => ({
    transform: [{
      scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }),
    }],
    opacity: val.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] }),
  });

  return (
    <View style={styles.revealWrap}>
      <View style={styles.revealHero}>
        <Animated.View style={[styles.pulseRing, pulseStyle(pulseA)]} />
        <Animated.View style={[styles.pulseRing, pulseStyle(pulseB)]} />
        <Animated.View style={[styles.pulseRing, pulseStyle(pulseC)]} />
        <Animated.View
          style={[
            styles.revealRing,
            { opacity: ringOpacity, transform: [{ scale: ringScale }] },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: checkScale }] }}>
            <Ionicons name="checkmark" size={48} color="#FFFFFF" />
          </Animated.View>
        </Animated.View>
      </View>

      <Animated.Text
        style={[styles.revealTitle, { opacity: titleOp, transform: [{ translateY: titleY }] }]}
      >
        You're in.
      </Animated.Text>

      <Animated.Text
        style={[styles.revealBody, { opacity: bodyOp, transform: [{ translateY: bodyY }] }]}
      >
        Your profile's ready. Step into your community and see who you're meant to find.
      </Animated.Text>

      <Animated.View
        style={{
          alignSelf: 'stretch',
          opacity: btnOp,
          transform: [{ translateY: btnY }],
        }}
      >
        <PrimaryButton
          label={busy ? 'Saving…' : 'See your connections'}
          onPress={onFinish}
          loading={busy}
          disabled={busy}
          style={styles.revealBtn}
        />
      </Animated.View>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function OnboardingScreen({ navigation }) {
  const { refreshProfile, signOut, profile } = useAuth();
  const confirm = useConfirm();

  async function doSignOut() {
    try { await signOut(); } catch (e) {
      toast({ title: 'Sign out failed', message: e?.message ?? 'Try again.', type: 'error' });
    }
  }

  // Lets the user bail out of onboarding back to the auth screens.
  // Persisted Supabase session means re-opening the app drops you straight into
  // onboarding (because onboarding_complete is still false). This is the escape hatch.
  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You can finish your profile later.',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (ok) doSignOut();
  }

  const [step, setStep]                     = useState(1);
  const [lifeStage, setLifeStage]           = useState(null);
  const [activities, setActivities]         = useState([]);
  const [familyValues, setFamilyValues]     = useState([]);
  const [schoolType, setSchoolType]         = useState(null);
  const [loveLanguage, setLoveLanguage]     = useState(null);
  const [initiator, setInitiator]           = useState(null);
  const [outgoing, setOutgoing]             = useState(null);
  const [politicalLean, setPoliticalLean]   = useState(null); // null = skipped
  const [denomination, setDenomination]     = useState(null); // null = skipped
  const [communityGoals, setCommunityGoals] = useState([]);
  // Free-text church name (was a picker; we don't have a curated directory yet).
  // Church is committed to DB immediately by ChurchPicker — no local state needed.

  // Real activities from Supabase (replaces ACTIVITIES mock — supports search +
  // user-requested interests via migration 0045).
  const [dbActivities, setDbActivities]       = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // Interest-request modal
  const [requestOpen, setRequestOpen]         = useState(false);

  // Submit state
  const [busy, setBusy] = useState(false);


  // Fetch activity taxonomy from Supabase. Replaces static ACTIVITIES so search
  // covers the full ~45-item list and stays in sync with migration 0045 +
  // future approved interest_requests.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('activities')
        .select('id, label, icon, icon_color, sort_order')
        .order('sort_order', { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.warn('[onboarding] activities fetch failed', error.message);
        setDbActivities([]);
      } else {
        setDbActivities(
          (data ?? []).map((r) => ({
            id: r.id,
            label: r.label,
            icon: r.icon,
            iconColor: r.icon_color,
          }))
        );
      }
      setActivitiesLoading(false);
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
      case 'family-values':   return true; // optional
      case 'school-type':     return true; // optional
      case 'love-language':   return loveLanguage !== null;
      case 'personality':     return initiator !== null && outgoing !== null;
      case 'political-lean':  return true; // optional
      case 'community-goals': return communityGoals.length >= 1;
      case 'denomination':    return true; // optional
      case 'church':          return true; // optional
      default:                return true;
    }
  };

  const handleContinue = () => {
    if (step < totalSteps) setStep((s) => s + 1);
  };

  const handleBack = () => {
    // Steps 2+: previous step.
    // Step 1: "back" means out of onboarding — but since Onboarding is the only
    // screen mounted in AppStack (we conditionally render it based on
    // needsOnboarding), there's nothing to go back to. So treat back-from-step-1
    // as a sign-out — drops user back to AuthStack (Splash → SignIn).
    if (step > 1) {
      setStep((s) => s - 1);
    } else {
      handleSignOut();
    }
  };

  // Submit: write profile to Supabase via the complete_onboarding RPC.
  // The RPC sets onboarding_complete=true; after refreshProfile() the root
  // navigator (in src/navigation/index.js) will auto-route to the Main stack.
  async function handleFinish() {
    if (busy) return;
    setBusy(true);
    try {
      // City/state were captured at signup (from the ZIP) and already live on
      // the profile — onboarding never asks for location. Pass the existing
      // values straight through: complete_onboarding does an unconditional
      // update of these columns, so sending them keeps them intact. The
      // geocoded PostGIS `location` point is set at signup / self-healed by
      // AuthContext — nothing to do here.
      const { error } = await supabase.rpc('complete_onboarding', {
        p_life_stage:    lifeStage,
        p_school_type:   schoolType,
        p_love_language: loveLanguage,
        p_church_id:     null,                    // curated directory not live yet
        p_city:          profile?.city ?? null,
        p_state:         profile?.state ?? null,
        p_is_initiator:   initiator,
        p_is_outgoing:    outgoing,
        p_political_lean:  politicalLean,
        p_denomination_id: denomination,
        p_activities:      activities,
        p_goals:          communityGoals,
        p_values:         familyValues,
      });
      if (error) throw error;

      // Church was committed immediately by ChurchPicker — nothing to do here.

      // Arm the first-time tutorial — HomeScreen reads this on mount.
      await markTutorialPending();
      await refreshProfile();
      // AppNavigator swaps from Onboarding → Main when onboarding_complete flips.
      // Reset busy defensively so the button isn't stuck if the swap is delayed
      // (e.g. slow network, double-tap, profile cache).
      setBusy(false);
    } catch (e) {
      toast({ title: 'Could not save your profile', message: e?.message ?? 'Unknown error. Try again.', type: 'error' });
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
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn} hitSlop={8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
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
          <StepActivities
            selections={activities}
            onToggle={toggle(setActivities)}
            activities={dbActivities}
            loading={activitiesLoading}
            onOpenRequest={() => setRequestOpen(true)}
          />
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
        {currentStepId === 'political-lean' && (
          <StepPoliticalLean value={politicalLean} onChange={setPoliticalLean} />
        )}
        {currentStepId === 'community-goals' && (
          <StepCommunityGoals selections={communityGoals} onToggle={toggle(setCommunityGoals)} />
        )}
        {currentStepId === 'church' && (
          <StepChurch />
        )}
        {currentStepId === 'denomination' && (
          <StepDenomination selection={denomination} onSelect={setDenomination} />
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

      <InterestRequestModal
        visible={requestOpen}
        onClose={() => setRequestOpen(false)}
      />
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
  signOutBtn: {
    height: 40,
    paddingHorizontal: 4,
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 40,
  },
  signOutText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.textSecondary,
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
  revealWrap: { alignItems: 'center', paddingTop: SPACING.xl, gap: SPACING.md },
  revealHero: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  revealRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: COLORS.text,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.lg,
  },
  pulseRing: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: COLORS.text,
  },
  revealStat: { alignItems: 'center', marginBottom: SPACING.sm },
  revealNumber: {
    fontFamily: FONT.serifItalic,
    fontSize: 76,
    color: COLORS.text,
    // lineHeight kept tight to the glyph; the unit caption sits below with a
    // positive margin so the two never collide (the old -8 margin overlapped
    // the number on web, where line-box metrics differ from native).
    lineHeight: 80,
    letterSpacing: -2,
    textAlign: 'center',
  },
  revealUnit: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: 6,
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

  // Request interest button (bottom of activities step)
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

  // Interest request modal
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
