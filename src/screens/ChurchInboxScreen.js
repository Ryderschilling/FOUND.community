// ─────────────────────────────────────────────────────────────────────────────
// ChurchInboxScreen
//
// App member → church messaging. Opened from ChurchProfileScreen's "Message Us"
// button (or via a church_reply notification tap).
//
// Shows:
//  - The member's past messages to this church (read-only history)
//  - A compose box to send a new message
//  - Church replies arrive as notifications; a "You have a reply" banner
//    appears when a church_reply notification exists for this church.
//
// Church admins read and reply from the dashboard — never here.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (sec < 60)     return 'just now';
  if (sec < 3600)   return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)  return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Message Row ──────────────────────────────────────────────────────────────

function MessageRow({ msg }) {
  return (
    <View style={[styles.bubble, msg.replied_at ? styles.bubbleReplied : null]}>
      <Text style={styles.bubbleBody}>{msg.body}</Text>
      <View style={styles.bubbleMeta}>
        <Text style={styles.bubbleTime}>{timeAgo(msg.created_at)}</Text>
        {msg.replied_at ? (
          <View style={styles.repliedBadge}>
            <Ionicons name="checkmark-done" size={12} color={COLORS.sage} />
            <Text style={styles.repliedText}>Replied</Text>
          </View>
        ) : msg.read_at ? (
          <Text style={styles.readText}>Seen</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChurchInboxScreen({ navigation, route }) {
  const { user } = useAuth();
  const churchId   = route?.params?.churchId;
  const churchName = route?.params?.churchName ?? 'Church';

  const [messages, setMessages]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [body, setBody]           = useState('');
  const [error, setError]         = useState(null);
  const [sentBanner, setSentBanner] = useState(false);
  const flatRef = useRef(null);

  const load = useCallback(async () => {
    if (!churchId || !user?.id) return;
    try {
      // Members can only see their own messages (RLS enforces this)
      const { data, error: err } = await supabase
        .from('church_messages')
        .select('id, body, read_at, replied_at, created_at')
        .eq('church_id', churchId)
        .eq('from_profile_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (err) throw err;
      setMessages(data ?? []);
    } catch (e) {
      // Non-critical — just show empty state
    }
    setLoading(false);
  }, [churchId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('send_message_to_church', {
        p_church_id: churchId,
        p_body: trimmed,
      });
      if (err) throw err;
      setBody('');
      setSentBanner(true);
      setTimeout(() => setSentBanner(false), 4000);
      load(); // refresh message list
    } catch (e) {
      setError('Could not send message. Try again.');
    }
    setSending(false);
  }, [body, sending, churchId, load]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation?.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{churchName}</Text>
            <Text style={styles.headerSub}>Church inbox</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Privacy note */}
        <View style={styles.privacyNote}>
          <Ionicons name="lock-closed-outline" size={13} color={COLORS.textTertiary} />
          <Text style={styles.privacyText}>
            Only {churchName}'s team can read your message. They'll reply via notification.
          </Text>
        </View>

        {/* Sent banner */}
        {sentBanner ? (
          <View style={styles.sentBanner}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
            <Text style={styles.sentBannerText}>Message sent! The team will be in touch.</Text>
          </View>
        ) : null}

        {/* Message history */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.textTertiary} />
          </View>
        ) : messages.length > 0 ? (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageRow msg={item} />}
            contentContainerStyle={styles.list}
            inverted
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={styles.center}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyBody}>
              Your message goes directly to {churchName}'s team on the FOUND church dashboard.
            </Text>
          </View>
        )}

        {/* Error */}
        {error ? (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Compose */}
        <View style={styles.compose}>
          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder={`Message ${churchName}…`}
            placeholderTextColor={COLORS.textTertiary}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!body.trim() || sending}
            activeOpacity={0.85}
          >
            {sending ? (
              <ActivityIndicator color={COLORS.accentText} size="small" />
            ) : (
              <Ionicons name="send" size={18} color={COLORS.accentText} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: FONT.bold, fontSize: 17, color: COLORS.text },
  headerSub:   { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 1 },

  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginHorizontal: SPACING.md,
    marginBottom: 8,
    padding: 10,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md ?? 12,
  },
  privacyText: { flex: 1, fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, lineHeight: 17 },

  sentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: SPACING.md,
    marginBottom: 8,
    padding: 12,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.md ?? 12,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
  },
  sentBannerText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.sage },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: SPACING.xl ?? 32,
  },
  emptyTitle: { fontFamily: FONT.bold, fontSize: 17, color: COLORS.text, marginTop: 8, textAlign: 'center' },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textTertiary, textAlign: 'center', lineHeight: 20 },

  list: { paddingHorizontal: SPACING.md, paddingVertical: 8 },

  bubble: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: SPACING.md,
    marginBottom: 8,
  },
  bubbleReplied: { borderColor: COLORS.sageLight },
  bubbleBody: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, lineHeight: 22 },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  bubbleTime: { fontFamily: FONT.regular, fontSize: 11, color: COLORS.textTertiary },
  repliedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  repliedText: { fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.sage },
  readText:    { fontFamily: FONT.regular,  fontSize: 11, color: COLORS.textTertiary },

  errorRow: { paddingHorizontal: SPACING.md, paddingBottom: 4 },
  errorText: { fontFamily: FONT.regular, fontSize: 13, color: '#D24A4A', textAlign: 'center' },

  compose: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 21,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
