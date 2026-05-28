import React from 'react';
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
import { useConfirm } from './ConfirmProvider';

// ─── State derivation ───────────────────────────────────────────────────────
// Visual state is a pure function of the match props. We don't keep local
// optimistic state here anymore — the parent (HomeScreen) owns truth so that
// "pending" can flip to "connected" the instant a reciprocal is detected.
//
//   match.isMatch === true             → CONNECTED (sage/green)
//   match.connected (my_kind === like) → PENDING   (gold/yellow)
//   otherwise                          → IDLE      (Connect button)
//
//   match.saved (in your private Connect Later list) → SAVED (bookmark button)
function connectState(match) {
  if (match.isMatch)  return 'connected';
  if (match.connected) return 'pending';
  return 'idle';
}

/**
 * PersonCard — match card in the Discover feed
 * Props:
 *   match { id, name, ..., connected, saved, theirKind, isMatch }
 *   onConnect()       — fires "like" insert
 *   onSave()          — toggles this person in your private Connect Later list
 *   onCancel(kind?)   — fires remove_connection(kind). kind=null = all kinds.
 *   onPress()         — opens MatchDetail
 */
export default function PersonCard({ match, onConnect, onSave, onCancel, onPress }) {
  const state = connectState(match);
  const confirm = useConfirm();

  const inboundBadge = (() => {
    if (match.isMatch)              return { label: 'FOUND!',            icon: 'sparkles',  color: COLORS.text,  bg: COLORS.surface };
    if (match.theirKind === 'like') return { label: 'Wants to connect',  icon: 'heart',     color: COLORS.clay,  bg: COLORS.clayBg };
    return null;
  })();

  // ── Connect button: tap behavior depends on state ──────────────────────
  async function handleConnectTap() {
    if (state === 'idle') {
      onConnect?.();
      return;
    }
    if (state === 'pending') {
      const ok = await confirm({
        title: 'Cancel request?',
        message: `${match.name} won't see your connection request anymore.`,
        confirmLabel: 'Cancel request',
        destructive: true,
      });
      if (ok) onCancel?.('like');
      return;
    }
    if (state === 'connected') {
      const ok = await confirm({
        title: 'Disconnect?',
        message: `You and ${match.name} will no longer be connected.`,
        confirmLabel: 'Disconnect',
        destructive: true,
      });
      if (ok) onCancel?.('like');
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
  : match.theirKind ? 'Accept'
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
        <View style={[styles.inboundBadge, { backgroundColor: inboundBadge.bg, borderWidth: 1, borderColor: COLORS.border }]}>
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
          gradientColors={match.avatarColor ?? [COLORS.text, '#3A3A3A']}
          uri={match.avatarUrl || undefined}
        />
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{match.name}</Text>
          <Text style={styles.meta}>{match.lifeStage} · {match.distance}</Text>
          {match.cityState ? (
            <View style={styles.churchRow}>
              <Ionicons name="location-outline" size={11} color={COLORS.textTertiary} />
              <Text style={styles.church}>{match.cityState}</Text>
            </View>
          ) : null}
        </View>
        <ScoreRing score={match.matchScore} size={52} stroke={4} />
      </View>

      <View style={styles.divider} />

      {/* Interest tags */}
      <View style={styles.tagsRow}>
        {match.sameHometown ? (
          <View style={[styles.tag, styles.tagHometown]}>
            <Ionicons name="home" size={11} color={COLORS.white} />
            <Text style={[styles.tagText, styles.tagHometownText]}>Same hometown</Text>
          </View>
        ) : null}
        {match.mutualCount > 0 ? (
          <View style={[styles.tag, styles.tagMutual]}>
            <Ionicons name="people" size={11} color={COLORS.sage} />
            <Text style={[styles.tagText, styles.tagMutualText]}>
              {match.mutualCount} mutual
            </Text>
          </View>
        ) : null}
        {match.interests.slice(0, (() => {
          let slots = 4;
          if (match.sameHometown) slots -= 1;
          if (match.mutualCount > 0) slots -= 1;
          return slots;
        })()).map((interest) => (
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

        {/* Connect Later — hide once connected (no point saving someone you're already connected to) */}
        {state !== 'connected' ? (
          <TouchableOpacity
            style={[styles.btnSave, match.saved && styles.btnSaveDone]}
            onPress={() => onSave?.()}
            activeOpacity={0.8}
            accessibilityLabel={match.saved ? 'Remove from Connect Later' : 'Save to Connect Later'}
          >
            <Ionicons
              name={match.saved ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={match.saved ? COLORS.sage : COLORS.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
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
  // Highlight chip when both profiles share a hometown — same shape as a
  // standard tag, but dark to draw the eye and signal "this is the reason".
  tagHometown:     { backgroundColor: COLORS.text, borderColor: COLORS.text },
  tagHometownText: { color: COLORS.white },
  // Mutual connections chip — sage green, signals social proof.
  tagMutual:     { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageLight },
  tagMutualText: { color: COLORS.sage },

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

  btnSave: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnSaveDone: { backgroundColor: COLORS.sageBg, borderColor: COLORS.sageMid },
});
