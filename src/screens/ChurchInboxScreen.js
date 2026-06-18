// ─────────────────────────────────────────────────────────────────────────────
// ChurchInboxScreen
//
// Full back-and-forth conversation between the app user and a church.
//
// Sent messages    = user → church  (church_messages table, direction='sent')
// Received replies = church → user  (notifications type='church_reply', direction='received')
//
// Data comes from get_church_conversation(p_church_id) RPC which returns both
// sides merged and sorted oldest-first.
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

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg, churchName }) {
  const isSent = msg.direction === 'sent';
  return (
    <View style={[styles.bubbleRow, isSent ? styles.bubbleRowSent : styles.bubbleRowReceived]}>
      {/* Church initial avatar on received side */}
      {!isSent && (
        <View style={styles.churchInitial}>
          <Text style={styles.churchInitialText}>
            {(churchName?.[0] ?? 'C').toUpperCase()}
          </Text>
        </View>
      )}

      <View style={[styles.bubble, isSent ? styles.bubbleSent : styles.bubbleReceived]}>
        {!isSent && (
          <Text style={styles.senderLabel}>{churchName}</Text>
        )}
        <Text style={[styles.bubbleBody, isSent ? styles.bubbleBodySent : styles.bubbleBodyReceived]}>
          {msg.body}
        </Text>
        <Text style={[styles.bubbleTime, isSent ? styles.bubbleTimeSent : styles.bubbleTimeReceived]}>
          {timeAgo(msg.created_at)}
        </Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChurchInboxScreen({ navigation, route }) {
  const { user } = useAuth();
  const churchId   = route?.params?.churchId;
  const churchName = route?.params?.churchName ?? 'Church';

  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [body,     setBody]     = useState('');
  const [error,    setError]    = useState(null);
  const flatRef = useRef(null);

  const load = useCallback(async () => {
    if (!churchId || !user?.id) return;
    try {
      const { data, error: err } = await supabase.rpc('get_church_conversation', {
        p_church_id: churchId,
      });
      if (err) throw err;
      setMessages(data ?? []);
    } catch (e) {
      // Non-critical — show empty state
    }
    setLoading(false);
  }, [churchId, user?.id]);

  // Mark church replies as read whenever this screen is active
  const markRead = useCallback(async () => {
    if (!churchId) return;
    try {
      await supabase.rpc('mark_church_replies_read', { p_church_id: churchId });
    } catch (_) {}
  }, [churchId]);

  useEffect(() => {
    markRead();
    load();
  }, [load, markRead]);

  useEffect(() => {
    const unsub = navigation?.addListener?.('focus', () => {
      markRead();
      load();
    });
    return unsub;
  }, [navigation, load, markRead]);

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
      await load();
      setTimeout(() => flatRef.current?.scrollToEnd?.({ animated: true }), 100);
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
            <Text style={styles.headerSub}>Church conversation</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Conversation */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.textTertiary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyBody}>
              Your message goes directly to {churchName}'s team. They'll reply here.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Bubble msg={item} churchName={churchName} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatRef.current?.scrollToEnd?.({ animated: false })}
          />
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontFamily: FONT.bold,    fontSize: 17, color: COLORS.text },
  headerSub:    { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textTertiary, marginTop: 1 },

  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: SPACING.xl ?? 32,
  },
  emptyTitle: { fontFamily: FONT.bold,    fontSize: 17, color: COLORS.text,          marginTop: 8, textAlign: 'center' },
  emptyBody:  { fontFamily: FONT.regular, fontSize: 14, color: COLORS.textTertiary,  textAlign: 'center', lineHeight: 20 },

  list: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },

  // ── Bubbles ──────────────────────────────────────────────────────────────
  bubbleRow:         { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 },
  bubbleRowSent:     { justifyContent: 'flex-end' },
  bubbleRowReceived: { justifyContent: 'flex-start', gap: 8 },

  churchInitial: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  churchInitialText: { fontFamily: FONT.bold, fontSize: 12, color: '#fff' },

  bubble: {
    maxWidth: '75%',
    borderRadius: RADIUS.lg ?? 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleSent:     { backgroundColor: '#1a1a1a', borderBottomRightRadius: 4 },
  bubbleReceived: {
    backgroundColor: COLORS.white,
    borderWidth: 1, borderColor: COLORS.border,
    borderBottomLeftRadius: 4,
  },

  senderLabel:        { fontFamily: FONT.semiBold, fontSize: 11, color: COLORS.textTertiary, marginBottom: 3 },
  bubbleBody:         { fontFamily: FONT.regular,  fontSize: 15, lineHeight: 22 },
  bubbleBodySent:     { color: '#fff' },
  bubbleBodyReceived: { color: COLORS.text },
  bubbleTime:         { fontFamily: FONT.regular,  fontSize: 11, marginTop: 4 },
  bubbleTimeSent:     { color: 'rgba(255,255,255,0.5)', textAlign: 'right' },
  bubbleTimeReceived: { color: COLORS.textTertiary },

  errorRow:  { paddingHorizontal: SPACING.md, paddingBottom: 4 },
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
    minHeight: 44, maxHeight: 120,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg ?? 16,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 10,
    fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, lineHeight: 21,
  },
  sendBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  sendBtnDisabled: { opacity: 0.4 },
});
