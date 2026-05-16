import React, { useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Pill, SectionHeader, RuleLabel } from '../components/Atoms';
import ScoreRing from '../components/ScoreRing';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

export default function MatchDetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const match = route?.params?.match ?? FALLBACK_MATCH;
  const [connected, setConnected] = useState(match.connected ?? false);
  const [waved, setWaved] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  async function handleConnect() {
    if (connected || !user || !match.id) return;
    setConnected(true); // optimistic
    const { error } = await supabase
      .from('connections')
      .upsert(
        { from_profile: user.id, to_profile: match.id, kind: 'like' },
        { onConflict: 'from_profile,to_profile,kind', ignoreDuplicates: true }
      );
    if (error) console.warn('[match] connect failed', error.message);
  }

  async function handleOpenChat() {
    if (openingChat || !user || !match.id) return;
    setOpeningChat(true);
    try {
      const { data: threadId, error } = await supabase
        .rpc('start_direct_thread', { p_other: match.id });
      if (error) throw error;
      navigation.navigate('Chat', {
        thread_id: threadId,
        other: {
          id:          match.id,
          name:        match.name,
          initials:    match.initials,
          avatarColor: match.avatarColor,
        },
      });
    } catch (e) {
      Alert.alert('Could not open chat', e?.message ?? 'Try again.');
    } finally {
      setOpeningChat(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Back nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* Hero */}
        <View style={styles.hero}>
          <Avatar
            initials={match.initials}
            size={96}
            gradientColors={match.avatarColor ?? [COLORS.sage, COLORS.clay]}
            uri={match.avatarUrl || undefined}
            style={styles.avatar}
          />

          {/* Score ring sits top-right of avatar */}
          <View style={styles.scoreWrap}>
            <ScoreRing score={match.matchScore} size={64} stroke={5} />
          </View>

          <Text style={styles.heroName}>{match.name}</Text>
          <Text style={styles.heroMeta}>{match.lifeStage} · {match.distance}</Text>

          {match.church ? (
            <View style={styles.churchRow}>
              <Ionicons name="business-outline" size={13} color={COLORS.textSecondary} />
              <Text style={styles.churchText}>{match.church}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.content}>

          {/* Highlight Reel */}
          {match.photos?.length > 0 && (
            <View style={styles.section}>
              <SectionHeader label="Highlight Reel" />
              <View style={styles.reelGrid}>
                {match.photos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={styles.reelImage} />
                ))}
              </View>
            </View>
          )}

          {/* Interests */}
          <View style={styles.section}>
            <SectionHeader label="Interests" />
            <View style={styles.pillsWrap}>
              {match.interests.map((i) => (
                <Pill key={i.id} label={i.label} variant="neutral" />
              ))}
            </View>
          </View>

          {/* Common ground */}
          <View style={styles.section}>
            <SectionHeader label="In Common" />
            <View style={styles.commonCard}>
              <View style={styles.commonRow}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                <Text style={styles.commonText}>Same life stage</Text>
              </View>
              {match.church ? (
                <View style={styles.commonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                  <Text style={styles.commonText}>Nearby church</Text>
                </View>
              ) : null}
              {match.interests.slice(0, 2).map((i) => (
                <View key={i.id} style={styles.commonRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
                  <Text style={styles.commonText}>Both into {i.label.toLowerCase()}</Text>
                </View>
              ))}
            </View>
          </View>

          <RuleLabel label="connect · wave · message" style={styles.rule} />

        </View>
      </ScrollView>

      {/* Sticky CTA bar */}
      <View style={styles.ctaBar}>
        {/* Wave */}
        <TouchableOpacity
          style={[styles.btnWave, waved && styles.btnWaveDone]}
          onPress={() => setWaved(true)}
          activeOpacity={0.8}
        >
          <Ionicons name={waved ? 'checkmark' : 'hand-left-outline'} size={20} color={waved ? COLORS.sage : COLORS.textSecondary} />
        </TouchableOpacity>

        {/* Connect */}
        <TouchableOpacity
          style={[styles.btnConnect, connected && styles.btnConnectDone]}
          onPress={handleConnect}
          disabled={connected}
          activeOpacity={0.85}
        >
          <Text style={[styles.btnConnectText, connected && styles.btnConnectTextDone]}>
            {connected ? '✓  Connected' : 'Connect'}
          </Text>
        </TouchableOpacity>

        {/* Message */}
        <TouchableOpacity
          style={styles.btnMessage}
          onPress={handleOpenChat}
          disabled={openingChat}
          activeOpacity={0.8}
        >
          {openingChat ? (
            <ActivityIndicator color={COLORS.text} size="small" />
          ) : (
            <Ionicons name="chatbubble-outline" size={20} color={COLORS.text} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Fallback if opened without route params
const FALLBACK_MATCH = {
  id: '0',
  name: 'Sarah M.',
  initials: 'SM',
  avatarColor: ['#7B9E6B', '#B87155'],
  matchScore: 87,
  lifeStage: 'Young Professional',
  distance: '0.8 mi',
  church: 'Seaside Community Church',
  interests: [
    { id: 'hiking', label: 'Hiking', icon: 'walk-outline' },
    { id: 'music', label: 'Music', icon: 'musical-notes-outline' },
    { id: 'coffee', label: 'Coffee', icon: 'cafe-outline' },
    { id: 'bible', label: 'Bible Study', icon: 'book-outline' },
  ],
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  nav: {
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

  // Hero section
  hero: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    position: 'relative',
  },
  avatar: { ...SHADOW.md },
  scoreWrap: {
    position: 'absolute',
    top: SPACING.xl + 60,
    right: '28%',
  },
  heroName: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: SPACING.md,
    marginBottom: 4,
  },
  heroMeta: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  churchRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  churchText: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },

  // Content
  content: { paddingHorizontal: SPACING.lg, gap: SPACING.lg },
  section: { gap: SPACING.sm },

  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  commonCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  commonRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  commonText: { fontFamily: FONT.regular, fontSize: 14, color: COLORS.text },

  rule: { marginVertical: SPACING.md },

  // Highlight Reel (read-only)
  reelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reelImage: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.border,
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
  btnWave: {
    width: 50,
    height: 50,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnWaveDone: { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageLight },
  btnConnect: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
  },
  btnConnectDone: { backgroundColor: COLORS.sageBg },
  btnConnectText: { fontFamily: FONT.bold, fontSize: 15, color: COLORS.white },
  btnConnectTextDone: { color: COLORS.sage },
  btnMessage: {
    width: 50,
    height: 50,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
