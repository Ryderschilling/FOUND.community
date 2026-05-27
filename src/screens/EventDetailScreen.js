// ─────────────────────────────────────────────────────────────────────────
// EventDetailScreen — view an event invite or your own created event.
//
// If viewer === creator:
//   Shows event details + attendee list with RSVP statuses + share button.
//
// If viewer === invitee:
//   Shows event details + RSVP buttons (Going / Can't Make It).
//   If already responded, shows current status.
//
// Route params:
//   { eventId: string, isCreator?: boolean }
//
// Share button uses the RN Share sheet — iOS/Android native.
// Share URL: https://found.community/invite/<share_token>
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Image,
  Share,
  RefreshControl,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  ['#1A1A1A', '#3A3A3A'], ['#2A2A2A', '#4A4A4A'], ['#3A3A3A', '#5A5A5A'],
  ['#1A1A1A', '#2A2A2A'], ['#4A4A4A', '#1A1A1A'],
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

function formatEventDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const date = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} at ${time}`;
}

// ─── Attendee row (creator view) ──────────────────────────────────────────
function AttendeeRow({ invite }) {
  const profile = invite.invitee;
  const name = profile?.full_name ?? 'Someone';
  const initials = initialsFor(name);
  const grad = gradientFor(profile?.id);

  const statusColor = invite.status === 'accepted'
    ? COLORS.sage
    : invite.status === 'declined'
    ? '#D24A4A'
    : COLORS.textTertiary;

  const statusLabel = invite.status === 'accepted'
    ? 'Going'
    : invite.status === 'declined'
    ? "Can't make it"
    : 'Pending';

  return (
    <View style={styles.attendeeRow}>
      <View style={styles.attendeeAvatar}>
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.attendeeAvatarImg} />
        ) : (
          <LinearGradient colors={grad} style={styles.attendeeAvatarImg}>
            <Text style={styles.attendeeInitials}>{initials}</Text>
          </LinearGradient>
        )}
      </View>
      <Text style={styles.attendeeName} numberOfLines={1}>{name}</Text>
      <View style={[styles.statusPill, { borderColor: statusColor }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function EventDetailScreen({ navigation, route }) {
  const { eventId } = route.params ?? {};
  const { user } = useAuth();

  const [event, setEvent]         = useState(null);
  const [creator, setCreator]     = useState(null);
  const [myInvite, setMyInvite]   = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responding, setResponding] = useState(false);
  const [error, setError]           = useState(null);

  // ── Invite-more modal state
  const [inviteOpen, setInviteOpen]       = useState(false);
  const [allConnections, setAllConns]     = useState([]);
  const [connsLoading, setConnsLoading]   = useState(false);
  const [inviteSelected, setInviteSelected] = useState(new Set());
  const [sending, setSending]             = useState(false);

  const isCreator = event?.creator_id === user?.id;

  const load = useCallback(async (opts = {}) => {
    if (opts.isRefresh) setRefreshing(true);

    console.log('[EventDetail] loading eventId:', eventId);
    if (!eventId) {
      console.error('[EventDetail] eventId is null/undefined — nothing to load');
      setError('No event ID provided.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // 1. Fetch event
    const { data: ev, error: evErr } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    console.log('[EventDetail] events query result:', { data: ev, error: evErr });

    if (evErr || !ev) {
      const msg = evErr?.message || evErr?.code || 'no rows returned';
      console.error('[EventDetail] failed to load event:', msg);
      setError(`Could not load event: ${msg}`);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setEvent(ev);

    // 2. Fetch creator profile
    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', ev.creator_id)
      .single();
    setCreator(creatorProfile);

    // 3. Fetch attendees (all invites with profile info — creator sees all, invitee sees own)
    const { data: invites } = await supabase
      .from('event_invites')
      .select(`
        id,
        status,
        invited_at,
        responded_at,
        invitee:profiles!invitee_id(id, full_name, avatar_url)
      `)
      .eq('event_id', eventId)
      .order('invited_at', { ascending: true });

    const allInvites = invites ?? [];
    setAttendees(allInvites);

    // 4. Find my own invite
    const mine = allInvites.find((i) => i.invitee?.id === user?.id);
    setMyInvite(mine ?? null);

    setLoading(false);
    setRefreshing(false);
  }, [eventId, user?.id]);

  useEffect(() => { load(); }, [load]);

  // Load connections when invite modal opens
  const openInviteModal = useCallback(async () => {
    setInviteOpen(true);
    if (allConnections.length > 0) return; // already loaded
    setConnsLoading(true);
    const { data } = await supabase.rpc('my_connections');
    setAllConns(data ?? []);
    setConnsLoading(false);
  }, [allConnections.length]);

  const toggleInvitee = useCallback((id) => {
    setInviteSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleSendInvites = useCallback(async () => {
    if (inviteSelected.size === 0 || !event?.id) return;
    setSending(true);
    await supabase.rpc('send_event_invites', {
      p_event_id:    event.id,
      p_invitee_ids: [...inviteSelected],
    });
    setSending(false);
    setInviteOpen(false);
    setInviteSelected(new Set());
    load(); // refresh attendee list
  }, [inviteSelected, event?.id, load]);

  const handleRsvp = async (status) => {
    setResponding(status);
    const { error: err } = await supabase.rpc('respond_to_invite', {
      p_event_id: eventId,
      p_status:   status,
    });
    setResponding(null);
    if (!err) {
      // Optimistic update on myInvite
      setMyInvite((prev) => ({ ...prev, status }));
      setAttendees((prev) =>
        prev.map((a) => a.invitee?.id === user?.id ? { ...a, status } : a),
      );
    }
  };

  const handleShare = async () => {
    // TODO (launch): replace with deep-link invite URL once
    // found.community/invite/[token] page is built.
    // The share_token is already on the event row — just swap
    // the URL to `https://found.community/invite/${event.share_token}`
    // and build the static invite page on Netlify.
    const url = 'https://found.community';
    try {
      await Share.share({
        title: event.title,
        message: `You're invited to ${event.title}! Check out FOUND: ${url}`,
        url, // iOS uses url; Android uses message
      });
    } catch (_) {
      // User cancelled — no-op
    }
  };

  // ── Counts for creator view
  const goingCount   = attendees.filter((a) => a.status === 'accepted').length;
  const pendingCount = attendees.filter((a) => a.status === 'pending').length;
  const declinedCount= attendees.filter((a) => a.status === 'declined').length;

  // ── Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={COLORS.textTertiary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingBox}>
          <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textTertiary} />
          <Text style={styles.errorLabel}>{error || 'Couldn\'t load this event.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const creatorName = creator?.full_name ?? 'Someone';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      {isCreator ? (
        <View style={styles.creatorHeader}>
          <TouchableOpacity
            style={styles.backToCommunityBtn}
            onPress={() => navigation.popToTop()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={16} color={COLORS.textSecondary} />
            <Text style={styles.backToCommunityText}>Back to Community</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{event.title}</Text>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={handleShare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="share-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ isRefresh: true })}
            tintColor={COLORS.textTertiary}
          />
        }
      >
        {/* Event card */}
        <View style={styles.card}>
          <Text style={styles.eventTitle}>{event.title}</Text>

          {/* Creator */}
          <View style={styles.creatorRow}>
            <View style={styles.creatorAvatar}>
              {creator?.avatar_url ? (
                <Image source={{ uri: creator.avatar_url }} style={styles.creatorAvatarImg} />
              ) : (
                <LinearGradient colors={gradientFor(creator?.id)} style={styles.creatorAvatarImg}>
                  <Text style={styles.creatorInitials}>{initialsFor(creatorName)}</Text>
                </LinearGradient>
              )}
            </View>
            <Text style={styles.creatorLabel}>
              {isCreator ? 'You planned this' : `Planned by ${creatorName}`}
            </Text>
          </View>

          {/* Date/time */}
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="calendar-outline" size={16} color={COLORS.sage} />
            </View>
            <Text style={styles.detailText}>{formatEventDateTime(event.event_time)}</Text>
          </View>

          {/* Location */}
          {event.location_name ? (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="location-outline" size={16} color={COLORS.sage} />
              </View>
              <Text style={styles.detailText}>{event.location_name}</Text>
            </View>
          ) : null}

          {/* Description */}
          {event.description ? (
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="document-text-outline" size={16} color={COLORS.sage} />
              </View>
              <Text style={styles.detailText}>{event.description}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Invitee: RSVP buttons ───────────────────────────── */}
        {!isCreator && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>YOUR RSVP</Text>
            {myInvite?.status === 'pending' || !myInvite ? (
              <View style={styles.rsvpRow}>
                <TouchableOpacity
                  style={[styles.rsvpBtn, styles.rsvpGoing, responding === 'accepted' && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={() => handleRsvp('accepted')}
                  disabled={!!responding}
                >
                  {responding === 'accepted'
                    ? <ActivityIndicator color={COLORS.white} size="small" />
                    : (
                      <>
                        <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                        <Text style={styles.rsvpBtnText}>I'm Going</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rsvpBtn, styles.rsvpDecline, responding === 'declined' && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={() => handleRsvp('declined')}
                  disabled={!!responding}
                >
                  {responding === 'declined'
                    ? <ActivityIndicator color={COLORS.textSecondary} size="small" />
                    : (
                      <>
                        <Ionicons name="close-circle-outline" size={18} color={COLORS.textSecondary} />
                        <Text style={styles.rsvpDeclineText}>Can't Make It</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.rsvpConfirmed}>
                <Ionicons
                  name={myInvite.status === 'accepted' ? 'checkmark-circle' : 'close-circle-outline'}
                  size={22}
                  color={myInvite.status === 'accepted' ? COLORS.sage : COLORS.textTertiary}
                />
                <Text style={[styles.rsvpConfirmedText, myInvite.status === 'accepted' && { color: COLORS.sage }]}>
                  {myInvite.status === 'accepted' ? "You're going!" : "You can't make it"}
                </Text>
                <TouchableOpacity onPress={() => setMyInvite((p) => ({ ...p, status: 'pending' }))}>
                  <Text style={styles.changeRsvp}>Change</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Creator: stats ──────────────────────────────────── */}
        {isCreator && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{goingCount}</Text>
              <Text style={styles.statLabel}>Going</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{pendingCount}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{declinedCount}</Text>
              <Text style={styles.statLabel}>Declined</Text>
            </View>
          </View>
        )}

        {/* ── Attendee list ──────────────────────────────────── */}
        {attendees.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>
                {isCreator ? 'INVITED' : 'WHO ELSE WAS INVITED'}
              </Text>
            </View>
            {attendees.map((invite) => (
              <AttendeeRow key={invite.id} invite={invite} />
            ))}
          </View>
        )}

        {/* Creator: Invite more + Share */}
        {isCreator && (
          <>
            <TouchableOpacity
              style={styles.inviteMoreBtn}
              onPress={openInviteModal}
              activeOpacity={0.8}
            >
              <Ionicons name="person-add-outline" size={18} color={COLORS.white} />
              <Text style={styles.inviteMoreText}>Invite More People</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareCard} onPress={handleShare} activeOpacity={0.8}>
              <Ionicons name="share-social-outline" size={20} color={COLORS.sage} />
              <View style={{ flex: 1 }}>
                <Text style={styles.shareCardTitle}>Share link</Text>
                <Text style={styles.shareCardSub}>
                  Anyone can view and join FOUND to RSVP.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Invite more modal ─────────────────────────────── */}
      <Modal
        visible={inviteOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInviteOpen(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setInviteOpen(false)} activeOpacity={0.7}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Invite People</Text>
            <TouchableOpacity
              onPress={handleSendInvites}
              disabled={inviteSelected.size === 0 || sending}
              activeOpacity={0.7}
            >
              {sending
                ? <ActivityIndicator color={COLORS.sage} size="small" />
                : <Text style={[styles.modalSend, inviteSelected.size === 0 && { opacity: 0.3 }]}>
                    Send{inviteSelected.size > 0 ? ` (${inviteSelected.size})` : ''}
                  </Text>
              }
            </TouchableOpacity>
          </View>

          {connsLoading ? (
            <View style={styles.modalEmpty}>
              <ActivityIndicator color={COLORS.textTertiary} />
            </View>
          ) : allConnections.length === 0 ? (
            <View style={styles.modalEmpty}>
              <Text style={styles.modalEmptyText}>No connections to invite yet.</Text>
            </View>
          ) : (
            <FlatList
              data={allConnections}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ padding: SPACING.md }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: COLORS.borderLight }} />}
              renderItem={({ item }) => {
                const selected = inviteSelected.has(item.id);
                const alreadyInvited = attendees.some((a) => a.invitee?.id === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.modalRow, alreadyInvited && { opacity: 0.4 }]}
                    activeOpacity={alreadyInvited ? 1 : 0.7}
                    onPress={() => { if (!alreadyInvited) toggleInvitee(item.id); }}
                  >
                    <View style={styles.modalAvatar}>
                      {item.avatar_url
                        ? <Image source={{ uri: item.avatar_url }} style={styles.modalAvatarImg} />
                        : <LinearGradient colors={gradientFor(item.id)} style={styles.modalAvatarImg}>
                            <Text style={styles.modalInitials}>{initialsFor(item.full_name)}</Text>
                          </LinearGradient>
                      }
                    </View>
                    <Text style={styles.modalName}>{item.full_name}</Text>
                    {alreadyInvited
                      ? <Text style={styles.alreadyTag}>Invited</Text>
                      : <View style={[styles.connCheck, selected && styles.connCheckSelected]}>
                          {selected && <Ionicons name="checkmark" size={13} color={COLORS.white} />}
                        </View>
                    }
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  creatorHeader: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  backToCommunityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  backToCommunityText: {
    fontFamily: FONT.medium,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONT.bold,
    fontSize: 18,
    color: COLORS.text,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  content: {
    paddingHorizontal: SPACING.md,
    paddingTop: 4,
    gap: SPACING.md,
  },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    ...SHADOW.sm,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },

  eventTitle: {
    fontFamily: FONT.bold,
    fontSize: 26,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginBottom: SPACING.md,
  },

  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  creatorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  creatorAvatarImg: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorInitials: {
    fontFamily: FONT.bold,
    fontSize: 10,
    color: COLORS.white,
  },
  creatorLabel: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  detailRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    alignItems: 'flex-start',
  },
  detailIcon: {
    width: 24,
    alignItems: 'center',
    paddingTop: 1,
  },
  detailText: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 22,
  },

  // RSVP
  rsvpRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  rsvpBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
  },
  rsvpGoing: {
    backgroundColor: COLORS.sage,
  },
  rsvpDecline: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  rsvpBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.white,
  },
  rsvpDeclineText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  rsvpConfirmed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  rsvpConfirmedText: {
    flex: 1,
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  changeRsvp: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: COLORS.sage,
  },

  // Stats (creator)
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    ...SHADOW.sm,
  },
  statNum: {
    fontFamily: FONT.bold,
    fontSize: 28,
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontFamily: FONT.medium,
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  // Attendees
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    gap: SPACING.sm,
  },
  attendeeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  attendeeAvatarImg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeInitials: {
    fontFamily: FONT.bold,
    fontSize: 12,
    color: COLORS.white,
  },
  attendeeName: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.text,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontFamily: FONT.medium,
    fontSize: 11,
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },

  inviteMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.text,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    ...SHADOW.md,
  },
  inviteMoreText: {
    fontFamily: FONT.bold,
    fontSize: 15,
    color: COLORS.white,
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontFamily: FONT.bold,
    fontSize: 17,
    color: COLORS.text,
  },
  modalCancel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  modalSend: {
    fontFamily: FONT.bold,
    fontSize: 15,
    color: COLORS.sage,
  },
  modalEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmptyText: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textTertiary,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: SPACING.sm,
  },
  modalAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  modalAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalInitials: {
    fontFamily: FONT.bold,
    fontSize: 14,
    color: COLORS.white,
  },
  modalName: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.text,
  },
  alreadyTag: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  connCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connCheckSelected: {
    backgroundColor: COLORS.sage,
    borderColor: COLORS.sage,
  },

  // Share CTA
  shareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
    padding: SPACING.md,
  },
  shareCardTitle: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
  },
  shareCardSub: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },

  // Loading / error
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorLabel: {
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
});
