import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from './Atoms';
import ScoreRing from './ScoreRing';

// ─── State derivation ───────────────────────────────────────────────────────
// Visual state is a pure function of the match props. We don't keep local
// optimistic state here anymore — the parent (HomeScreen) owns truth so that
// "pending" can flip to "connected" the instant a reciprocal is detected.
//
//   match.isMatch === true             → CONNECTED (sage/green)
//   match.connected (my_kind === like) → PENDING   (gold/yellow)
//   otherwise                          → IDLE      (Connect button)
//
//   match.waved (my_kind === wave)     → WAVED     (the small wave button)
function connectState(match) {
  if (match.isMatch)  return 'connected';
  if (match.connected) return 'pending';
  return 'idle';
}

// Cross-platform confirm. Alert.alert callbacks don't fire on web.
function confirmThen(title, message, onConfirm, destructiveLabel = 'Remove') {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message ?? ''}`.trim())) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: destructiveLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

/**
 * PersonCard — match card in the Discover feed
 * Props:
 *   match { id, name, ..., connected, waved, theirKind, isMatch }
 *   onConnect()       — fires "like" insert
 *   onWave()          — fires "wave" insert
 *   onCancel(kind?)   — fires remove_connection(kind). kind=null = all kinds.
 *   onPress()         — opens MatchDetail
 */
export default function PersonCard({ match, onConnect, onWave, onCancel, onPress }) {
  const state = connectState(match);

  const inboundBadge = (() => {
    if (match.isMatch)              return { label: "It's a match",      icon: 'sparkles',  color: COLORS.sage };
    if (match.theirKind === 'like') return { label: 'Wants to connect',  icon: 'heart',     color: COLORS.clay };
    if (match.theirKind === 'wave') return { label: 'Waved at you',      icon: 'hand-left', color: COLORS.gold };
    return null;
  })();

  // ── Connect button: tap behavior depends on state ──────────────────────
  function handleConnectTap() {
    if (state === 'idle') {
      onConnect?.();
      return;
    }
    if (state === 'pending') {
      confirmThen(
        'Cancel request?',
        `${match.name} won't see your connection request anymore.`,
        () => onCancel?.('like'),
        'Cancel request',
      );
      return;
    }
    if (state === 'connected') {
      confirmThen(
        'Disconnect?',
        `You and ${match.name} will no longer be connected.`,
        () => onCancel?.('like'),
        'Disconnect',
      );
    }
  }

  // ── Wave button: tap behavior depends on state ─────────────────────────
  function handleWaveTap() {
    if (match.waved) {
      confirmThen(
        'Cancel wave?',
        `Your wave to ${match.name} will be undone.`,
        () => onCancel?.('wave'),
        'Cancel wave',
      );
    } else {
      onWave?.();
    }
  }

  // Style + label for the connect button
  const connectStyle =
    state === 'connected' ? styles.btnConnectDone
  : state === 'pending'   ? styles.btnConnectPending
  : styles.btnConnect;

  const connectTextStyle =
    state === 'connected' ? styles.btnConnectTextDone
  : state === 'pending'   ? styles.btnConnectTextPending
  : styles.btnConnectText;

  const connectLabel =
    state === 'connected' ? 'Connected'
  : state === 'pending'   ? 'Pending'
  : 'Connect';

  const connectIcon =
    state === 'connected' ? 'checkmark'
  : state === 'pending'   ? 'time-outline'
  : null;

  const connectIconColor =
    state === 'connected' ? COLORS.sage
  : state === 'pending'   ? COLORS.gold
  : COLORS.white;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.97, transform: [{ scale: 0.99 }] }]}
      onPress={onPress}
    >
      {/* Inbound signal badge */}
      {inboundBadge ? (
        <View style={[styles.inboundBadge, { backgroundColor: COLORS.sageBg }]}>
          <Ionicons name={inboundBadge.icon} size={11} color={inboundBadge.color} />
          <Text style={[styles.inboundText, { color: inboundBadge.color }]}>
            {inboundBadge.label}
          </Text>
        </View>
      ) : null}

      {/* Top row */}
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
          style={connectStyle}
          onPress={handleConnectTap}
          activeOpacity={0.8}
        >
          <View style={styles.btnConnectInner}>
            {connectIcon ? <Ionicons name={connectIcon} size={14} color={connectIconColor} /> : null}
            <Text style={connectTextStyle}>{connectLabel}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnWave, match.waved && styles.btnWaveDone]}
          onPress={handleWaveTap}
          activeOpacity={0.8}
        >
          <Ionicons
            name={match.waved ? 'checkmark' : 'hand-left-outline'}
            size={18}
            color={match.waved ? COLORS.sage : COLORS.textSecondary}
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

  // Idle (default dark CTA)
  btnConnect: {
    flex: 1,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnConnectText: { fontFamily: FONT.bold, fontSize: 14, color: COLORS.white, letterSpacing: 0.2 },

  // Pending — gold/yellow, tappable
  btnConnectPending: {
    flex: 1,
    backgroundColor: COLORS.goldBg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.gold,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnConnectTextPending: { fontFamily: FONT.bold, fontSize: 14, color: COLORS.gold, letterSpacing: 0.2 },

  // Connected — sage/green, tappable (to disconnect)
  btnConnectDone: {
    flex: 1,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.sageMid,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnConnectTextDone: { fontFamily: FONT.bold, fontSize: 14, color: COLORS.sage, letterSpacing: 0.2 },

  btnConnectInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },

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
