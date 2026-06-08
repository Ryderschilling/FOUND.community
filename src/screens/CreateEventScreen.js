// ─────────────────────────────────────────────────────────────────────────
// CreateEventScreen — create an event and invite your connections.
//
// Flow:
//   1. Fill out title, date/time, location, description.
//   2. Pick connections to invite (multi-select from my_connections()).
//   3. Tap "Send Invites" → create_event RPC → invites + notifications fire.
//
// Requires: npx expo install @react-native-community/datetimepicker
// ─────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { scheduleEventReminder } from '../lib/eventReminders';

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

function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
// Web date input helpers — format Date ↔ "YYYY-MM-DD" / "HH:MM"
function toDateInputVal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toTimeInputVal(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Connection chip ──────────────────────────────────────────────────────
function ConnectionRow({ conn, selected, onToggle }) {
  const initials = initialsFor(conn.full_name);
  const grad = gradientFor(conn.profile_id);
  return (
    <TouchableOpacity
      style={[styles.connRow, selected && styles.connRowSelected]}
      activeOpacity={0.7}
      onPress={() => onToggle(conn.profile_id)}
    >
      <View style={styles.connAvatar}>
        {conn.avatar_url ? (
          <Image source={{ uri: conn.avatar_url }} style={styles.connAvatarImg} />
        ) : (
          <LinearGradient colors={grad} style={styles.connAvatarImg}>
            <Text style={styles.connInitials}>{initials}</Text>
          </LinearGradient>
        )}
      </View>
      <Text style={styles.connName} numberOfLines={1}>{conn.full_name}</Text>
      <View style={[styles.connCheck, selected && styles.connCheckSelected]}>
        {selected && <Ionicons name="checkmark" size={13} color={COLORS.white} />}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────
export default function CreateEventScreen({ navigation, route }) {
  const { user } = useAuth();
  // When launched from a group, skip the connections picker and link the event to that group
  const groupId   = route?.params?.groupId   ?? null;
  const groupName = route?.params?.groupName ?? null;

  // titleRef captures the raw input value on web — React's reconciliation
  // can reset controlled TextInput state when native HTML inputs (date/time)
  // trigger re-renders. The ref is always current regardless.
  const titleRef = useRef(route?.params?.initialTitle ?? '');
  const [title, setTitle]         = useState(route?.params?.initialTitle ?? '');
  const [eventDate, setEventDate] = useState(() => {
    if (route?.params?.initialDate) return new Date(route.params.initialDate);
    // Default to tomorrow at noon
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [locationName, setLocationName]     = useState(route?.params?.initialLocation ?? '');
  const [description, setDescription]       = useState(route?.params?.initialDesc ?? '');

  const [connections, setConnections]   = useState([]);
  const [connLoading, setConnLoading]   = useState(true);
  // Plain object { [profileId]: true } instead of Set — avoids React Native Web
  // quirks where Set state updates don't always trigger reliable re-renders.
  const [selectedIds, setSelectedIds]   = useState({});

  const [recurrence, setRecurrence] = useState(route?.params?.recurrence ?? null);
  // For monthly_nth: {weekday: 0–6 (0=Sun), weeks: [1–4]}
  const [recurrenceRule, setRecurrenceRule] = useState(route?.params?.recurrenceRule ?? null);
  const [showNthPicker, setShowNthPicker] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);

  // Load connections on mount
  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.rpc('my_connections');
      if (!err && data) setConnections(data);
      setConnLoading(false);
    })();
  }, []);

  const toggleConnection = useCallback((id) => {
    setSelectedIds((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: true };
    });
  }, []);

  const handleDateChange = (_, selected) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selected) {
      setEventDate((prev) => {
        const d = new Date(selected);
        d.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        return d;
      });
    }
  };

  const handleTimeChange = (_, selected) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selected) {
      setEventDate((prev) => {
        const d = new Date(prev);
        d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        return d;
      });
    }
  };

  const handleSubmit = async () => {
    const effectiveTitle = title.trim() || titleRef.current.trim();
    if (!effectiveTitle) { setError('Add a title.'); return; }
    setError(null);
    setSubmitting('create');

    const { data: eventId, error: err } = await supabase.rpc('create_event', {
      p_title:         effectiveTitle,
      p_event_time:    eventDate.toISOString(),
      p_location_name: locationName.trim() || null,
      p_location_lat:  null,
      p_location_lng:  null,
      p_description:   description.trim() || null,
      p_invitee_ids:   groupId ? null : (Object.keys(selectedIds).length > 0 ? Object.keys(selectedIds) : null),
      p_group_id:      groupId ?? null,
      p_recurrence:      recurrence ?? null,
      p_recurrence_rule: recurrence === 'monthly_nth' ? recurrenceRule : null,
    });

    setSubmitting(null);

    if (err) {
      setError(`Error: ${err.message || JSON.stringify(err)}`);
      return;
    }
    if (!eventId) {
      setError('Event was not saved. Try again.');
      return;
    }

    // Schedule a local reminder for the creator (they're always going)
    scheduleEventReminder({
      id:         eventId,
      title:      effectiveTitle,
      event_time: eventDate.toISOString(),
    });

    // navigate (not replace) so back button returns here
    navigation.navigate('EventDetail', { eventId, isCreator: true });
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{groupName ? `Event for ${groupName}` : 'New Invite'}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Event details card */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>EVENT DETAILS</Text>

            {/* Title */}
            <TextInput
              style={styles.titleInput}
              placeholder="Event name (e.g. Beach Day)"
              placeholderTextColor={COLORS.textTertiary}
              value={title}
              onChangeText={(v) => { titleRef.current = v; setTitle(v); }}
              maxLength={80}
              returnKeyType="next"
            />

            {/* Date row — web uses native HTML input, native uses DateTimePicker */}
            {Platform.OS === 'web' ? (
              <View style={styles.fieldRow}>
                <Ionicons name="calendar-outline" size={18} color={COLORS.sage} />
                <input
                  type="date"
                  value={toDateInputVal(eventDate)}
                  min={toDateInputVal(new Date())}
                  onChange={(e) => {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    setEventDate((prev) => {
                      const next = new Date(prev);
                      next.setFullYear(y, m - 1, d);
                      return next;
                    });
                  }}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    fontFamily: 'Inter_500Medium', fontSize: 15, color: '#1A1A1A',
                    outline: 'none', cursor: 'pointer',
                  }}
                />
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.fieldRow}
                  activeOpacity={0.7}
                  onPress={() => { setShowTimePicker(false); setShowDatePicker(true); }}
                >
                  <Ionicons name="calendar-outline" size={18} color={COLORS.sage} />
                  <Text style={styles.fieldValue}>{formatDate(eventDate)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>
                {showDatePicker && Platform.OS === 'ios' && (
                  <View style={styles.inlinePicker}>
                    <DateTimePicker
                      value={eventDate} mode="date" display="inline"
                      onChange={handleDateChange} minimumDate={new Date()} themeVariant="light"
                    />
                    <TouchableOpacity style={styles.pickerDone} onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {showDatePicker && Platform.OS === 'android' && (
                  <DateTimePicker value={eventDate} mode="date" onChange={handleDateChange} minimumDate={new Date()} />
                )}
              </>
            )}

            {/* Time row */}
            {Platform.OS === 'web' ? (
              <View style={styles.fieldRow}>
                <Ionicons name="time-outline" size={18} color={COLORS.sage} />
                <input
                  type="time"
                  value={toTimeInputVal(eventDate)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setEventDate((prev) => {
                      const next = new Date(prev);
                      next.setHours(h, m, 0, 0);
                      return next;
                    });
                  }}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    fontFamily: 'Inter_500Medium', fontSize: 15, color: '#1A1A1A',
                    outline: 'none', cursor: 'pointer',
                  }}
                />
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.fieldRow}
                  activeOpacity={0.7}
                  onPress={() => { setShowDatePicker(false); setShowTimePicker(true); }}
                >
                  <Ionicons name="time-outline" size={18} color={COLORS.sage} />
                  <Text style={styles.fieldValue}>{formatTime(eventDate)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
                </TouchableOpacity>
                {showTimePicker && Platform.OS === 'ios' && (
                  <View style={styles.inlinePicker}>
                    <DateTimePicker
                      value={eventDate} mode="time" display="spinner"
                      onChange={handleTimeChange} themeVariant="light"
                    />
                    <TouchableOpacity style={styles.pickerDone} onPress={() => setShowTimePicker(false)}>
                      <Text style={styles.pickerDoneText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {showTimePicker && Platform.OS === 'android' && (
                  <DateTimePicker value={eventDate} mode="time" onChange={handleTimeChange} />
                )}
              </>
            )}

            {/* Location */}
            <View style={styles.fieldRow}>
              <Ionicons name="location-outline" size={18} color={COLORS.sage} />
              <TextInput
                style={styles.inlineInput}
                placeholder="Location (optional)"
                placeholderTextColor={COLORS.textTertiary}
                value={locationName}
                onChangeText={setLocationName}
                maxLength={100}
              />
            </View>

            {/* Description */}
            <View style={[styles.fieldRow, { alignItems: 'flex-start', paddingTop: SPACING.sm + 2 }]}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.sage} style={{ marginTop: 2 }} />
              <TextInput
                style={[styles.inlineInput, { minHeight: 72 }]}
                placeholder="About this event (optional)"
                placeholderTextColor={COLORS.textTertiary}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
            </View>

            {/* Recurrence */}
            <View style={styles.fieldRow}>
              <Ionicons name="repeat-outline" size={18} color={COLORS.sage} />
              <View style={styles.recurrenceChips}>
                {[
                  { label: 'Once',     value: null },
                  { label: 'Weekly',   value: 'weekly' },
                  { label: 'Bi-weekly',value: 'biweekly' },
                  { label: 'Monthly',  value: 'monthly' },
                  { label: 'Nth Day ▾',value: 'monthly_nth' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={String(opt.value)}
                    activeOpacity={0.7}
                    style={[
                      styles.recurrenceChip,
                      recurrence === opt.value && styles.recurrenceChipActive,
                    ]}
                    onPress={() => {
                      setRecurrence(opt.value);
                      if (opt.value === 'monthly_nth') {
                        // Default to 1st Wednesday if nothing set yet
                        if (!recurrenceRule) setRecurrenceRule({ weekday: 3, weeks: [1] });
                        setShowNthPicker(true);
                      }
                    }}
                  >
                    <Text style={[
                      styles.recurrenceChipText,
                      recurrence === opt.value && styles.recurrenceChipTextActive,
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Nth-day sub-picker — shown inline when monthly_nth is active */}
            {recurrence === 'monthly_nth' && (() => {
              const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
              const WEEKS = [
                { label: '1st', value: 1 },
                { label: '2nd', value: 2 },
                { label: '3rd', value: 3 },
                { label: '4th', value: 4 },
              ];
              const rule = recurrenceRule ?? { weekday: 3, weeks: [1] };
              const toggleWeek = (w) => {
                const curr = rule.weeks ?? [];
                const next = curr.includes(w) ? curr.filter(x => x !== w) : [...curr, w].sort();
                setRecurrenceRule({ ...rule, weeks: next.length ? next : [w] });
              };
              return (
                <View style={styles.nthPickerContainer}>
                  <Text style={styles.nthLabel}>Day of week</Text>
                  <View style={styles.nthRow}>
                    {DAYS.map((d, i) => (
                      <TouchableOpacity
                        key={d}
                        activeOpacity={0.7}
                        style={[styles.nthChip, rule.weekday === i && styles.nthChipActive]}
                        onPress={() => setRecurrenceRule({ ...rule, weekday: i })}
                      >
                        <Text style={[styles.nthChipText, rule.weekday === i && styles.nthChipTextActive]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={[styles.nthLabel, { marginTop: SPACING.sm }]}>Which weeks</Text>
                  <View style={styles.nthRow}>
                    {WEEKS.map(({ label, value }) => {
                      const active = (rule.weeks ?? []).includes(value);
                      return (
                        <TouchableOpacity
                          key={value}
                          activeOpacity={0.7}
                          style={[styles.nthChip, active && styles.nthChipActive]}
                          onPress={() => toggleWeek(value)}
                        >
                          <Text style={[styles.nthChipText, active && styles.nthChipTextActive]}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {recurrenceRule && (
                    <Text style={styles.nthPreview}>
                      Repeats every {(recurrenceRule.weeks ?? [1]).map(w => ['','1st','2nd','3rd','4th'][w]).join(' & ')} {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][recurrenceRule.weekday]}
                    </Text>
                  )}
                </View>
              );
            })()}
          </View>

          {/* Connection picker — hidden when creating from a group (all members auto-invited) */}
          {groupId ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>INVITES</Text>
              <Text style={styles.emptyConn}>
                All members of {groupName || 'this group'} will be automatically invited.
              </Text>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionLabel}>INVITE YOUR CONNECTIONS</Text>
                {Object.keys(selectedIds).length > 0 && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{Object.keys(selectedIds).length}</Text>
                  </View>
                )}
              </View>

              {connLoading ? (
                <ActivityIndicator color={COLORS.textTertiary} style={{ paddingVertical: 24 }} />
              ) : connections.length === 0 ? (
                <Text style={styles.emptyConn}>
                  Connect with people on FOUND first — they'll show up here.
                </Text>
              ) : (
                connections.map((conn) => (
                  <ConnectionRow
                    key={conn.profile_id}
                    conn={conn}
                    selected={!!selectedIds[conn.profile_id]}
                    onToggle={toggleConnection}
                  />
                ))
              )}
            </View>
          )}

          {/* Error */}
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          {/* Create button */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            activeOpacity={0.8}
            onPress={handleSubmit}
            disabled={!!submitting}
          >
            {submitting === 'create' ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <>
                <Ionicons name="calendar" size={16} color={COLORS.white} />
                <Text style={styles.submitText}>Create Event</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
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
    fontSize: 20,
    color: COLORS.text,
    textAlign: 'center',
    marginHorizontal: SPACING.sm,
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
    gap: 2,
    ...SHADOW.sm,
  },

  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: COLORS.textTertiary,
    letterSpacing: 0.8,
    marginBottom: SPACING.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  countBadge: {
    backgroundColor: COLORS.sage,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontFamily: FONT.bold,
    fontSize: 11,
    color: COLORS.white,
  },

  titleInput: {
    fontFamily: FONT.bold,
    fontSize: 22,
    color: COLORS.text,
    paddingVertical: SPACING.sm,
    paddingHorizontal: 2,
    marginBottom: SPACING.sm,
  },

  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  fieldValue: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.text,
  },
  inlineInput: {
    flex: 1,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    paddingVertical: 0,
  },

  recurrenceChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  recurrenceChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  recurrenceChipActive: {
    borderColor: COLORS.sage,
    backgroundColor: '#F0F7F0',
  },
  recurrenceChipText: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  recurrenceChipTextActive: {
    color: COLORS.sage,
  },
  // Nth-day sub-picker
  nthPickerContainer: {
    marginTop: SPACING.sm,
    marginLeft: 26,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  nthLabel: {
    fontFamily: FONT.medium,
    fontSize: 11,
    color: COLORS.textTertiary,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  nthRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  nthChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  nthChipActive: {
    borderColor: COLORS.sage,
    backgroundColor: '#F0F7F0',
  },
  nthChipText: {
    fontFamily: FONT.medium,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  nthChipTextActive: {
    color: COLORS.sage,
  },
  nthPreview: {
    marginTop: SPACING.sm,
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.sage,
    fontStyle: 'italic',
  },
  inlinePicker: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: SPACING.sm,
  },
  pickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  pickerDoneText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.sage,
  },

  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    gap: SPACING.sm,
  },
  connRowSelected: {
    backgroundColor: COLORS.sageBg,
    marginHorizontal: -SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  connAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  connAvatarImg: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connInitials: {
    fontFamily: FONT.bold,
    fontSize: 13,
    color: COLORS.white,
  },
  connName: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: 15,
    color: COLORS.text,
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

  emptyConn: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textTertiary,
    textAlign: 'center',
    paddingVertical: SPACING.lg,
    lineHeight: 20,
  },

  errorText: {
    fontFamily: FONT.medium,
    fontSize: 13,
    color: '#D24A4A',
    textAlign: 'center',
  },

  shareBtn: {
    borderRadius: RADIUS.md,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  shareBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  submitBtn: {
    backgroundColor: COLORS.text,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    ...SHADOW.md,
  },
  submitText: {
    fontFamily: FONT.bold,
    fontSize: 16,
    color: COLORS.white,
    letterSpacing: 0.2,
  },
});
