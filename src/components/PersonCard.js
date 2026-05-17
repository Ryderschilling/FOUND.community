import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from './Atoms';
import ScoreRing from './ScoreRing';

/**
 * PersonCard — match card in the Discover feed
 * Props:
 *   match {
 *     id, name, initials, avatarColor, matchScore, lifeStage, distance, church, interests,
 *     connected,        // my_kind === 'like'
 *     waved,            // my_kind === 'wave'
 *     theirKind,        // 'like' | 'wave' | null  — what they did toward me
 *     isMatch,          // both 'like' → true
 *   }
 *   onConnect / onWave / onPress  — handlers
 */
export default function PersonCard({ match, onConnect, onWave, onPress }) {
  // Local optimistic mirrors so the button reflects the tap before the network round trip.
  const [connected, setConnected] = useState(match.connected ?? false);
  const [waved, setWaved]         = useState(match.waved ?? false);

  // Re-sync if parent refetches.
  useEffect(() => { if (match.connected) setConnected(true); }, [match.connected]);
  useEffect(() => { if (match.waved)     setWaved(true);     }, [match.waved]);

  const inboundBadge = (() => {
    if (match.isMatch)              return { label: "It's a match",      icon: 'sparkles',         color: COLORS.sage };
    if (match.theirKind === 'like') return { label: 'Wants to connect',  icon: 'heart',            color: COLORS.clay };
    if (match.theirKind === 'wave') return { label: 'Waved at you',      icon: 'hand-left',        color: COLORS.gold };
    return null;
  })();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.97, transform: [{ scale: 0.99 }] }]}
      onPress={onPress}
    >
      {/* Inbound signal badge (only shown if the other person has acted) */}
      {inboundBadge ? (
        <View style={[styles.inboundBadge, { backgroundColor: COLORS.sageBg }]}>
          <Ionicons name={inboundBadge.icon} size={11} color={inboundBadge.color} />
          <Text style={[styles.inboundText, { color: inboundBadge.color }]}>
            {inboundBadge.label}
          </Text>
        </View>
      ) : null}

      {/* Top row: avatar + name/meta + score ring */}
      <View style={styles.header}>
        <Avatar
          initials={match.initials}
          size={52}
          gradientColors={match.avatarColor ?? [COLORS.sage, COLORS.clay]}
          uri={match.avatarUrl || undefined}
        />

        <View style={styles.headerInfo}>
          <Text style={styles.name}>{match.name}</Text>
          <Text style={styles.meta}>{match.lifeStage} · {match.distance}</Text>
          {match.church ? (
            <View style={styles.churchRow}>
              <Ionicons name="business-outline" size={11} color={COLORS.textTertiary} />
              <Text style={styles.church}>{match.church}</Text>
            </View>
          ) : null}
        </View>

        <ScoreRing score={match.matchScore} size={52} stroke={4} />
      </View>

      {/* Horizontal rule */}
      <View style={styles.divider} />

      {/* Interest tags */}
      <View style={styles.tagsRow}>
        {match.interests.slice(0, 4).map((interest) => (
          <View key={interest.id} style={styles.tag}>
            <Ionicons name={interest.icon} size={11} color={interest.iconColor ?? COLORS.textSecondary} />
            <Text style={styles.tagText}>{interest.label}</Text>
          </View>
        ))}
      </View>

      {/* Action row */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btnConnect, connected && styles.btnConnectDone]}
          onPress={() => { setConnected(true); onConnect?.(); }}
          disabled={connected}
          activeOpacity={0.8}
        >
          <View style={styles.btnConnectInner}>
            {connected && <Ionicons name="checkmark" size={14} color={COLORS.sage} />}
            <Text style={[styles.btnConnectText, connected && styles.btnConnectTextDone]}>
              {connected ? (match.isMatch ? "It's a match" : 'Connected') : 'Connect'}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnWave, waved && styles.btnWaveDone]}
          onPress={() => { setWaved(true); onWave?.(); }}
          disabled={waved}
          activeOpacity={0.8}
        >
          <Ionicons
            name={waved ? 'checkmark' : 'hand-left-outline'}
            size={18}
            color={waved ? COLORS.sage : COLORS.textSecondary}
          />
        </TouchableOpacity>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.md,
  },

  // Inbound signal (sits above the header row)
  inboundBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.sm,
  },
  inboundText: {
    fontFamily: FONT.semiBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: SPACING.md,
  },
  headerInfo: { flex: 1, gap: 2 },
  name: { fontFamily: FONT.serifItalic, fontSize: 18, color: COLORS.text, letterSpacing: -0.2 },
  meta: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },
  churchRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  church:    { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary },

  divider: { height: 1, backgroundColor: COLORS.borderLight, marginBottom: SPACING.md },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: SPACING.md },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagText: { fontFamily: FONT.semiBold, fontSize: 12, color: COLORS.textSecondary },

  actions: { flexDirection: 'row', gap: 8 },
  btnConnect: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnConnectDone: { backgroundColor: COLORS.sageBg },
  btnConnectInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  btnConnectText: { fontFamily: FONT.bold, fontSize: 14, color: COLORS.white, letterSpacing: 0.2 },
  btnConnectTextDone: { color: COLORS.sage },
  btnWave: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnWaveDone: { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageMid },
});
