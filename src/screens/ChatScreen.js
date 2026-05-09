import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar } from '../components/Atoms';

const SEED_MESSAGES = [
  { id: '1', text: 'Hey! Great to connect 👋', sender: 'them', time: '10:22 AM' },
  { id: '2', text: 'You too! I noticed you go to Seaside — I\'ve been there a couple times.', sender: 'me', time: '10:23 AM' },
  { id: '3', text: 'Oh awesome! We have a young adults group on Thursdays if you\'re ever interested.', sender: 'them', time: '10:24 AM' },
  { id: '4', text: 'That sounds great, I\'ve been looking for something like that.', sender: 'me', time: '10:25 AM' },
];

function Bubble({ message }) {
  const isMe = message.sender === 'me';
  return (
    <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
        <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
          {message.text}
        </Text>
      </View>
      <Text style={styles.bubbleTime}>{message.time}</Text>
    </View>
  );
}

export default function ChatScreen({ route, navigation }) {
  const thread = route?.params?.thread ?? { name: 'Sarah M.', initials: 'SM', avatarColor: ['#7B9E6B', '#B87155'] };
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    const newMsg = {
      id: Date.now().toString(),
      text,
      sender: 'me',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Nav bar */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>

        <View style={styles.navCenter}>
          <Avatar
            initials={thread.initials}
            size={34}
            gradientColors={thread.avatarColor ?? [COLORS.sage, COLORS.clay]}
          />
          <View>
            <Text style={styles.navName}>{thread.name}</Text>
            <Text style={styles.navStatus}>Connected via FOUND</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.moreBtn} activeOpacity={0.7}>
          <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Rule */}
      <View style={styles.navRule} />

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Bubble message={item} />}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={input}
            onChangeText={setInput}
            placeholder="Message..."
            placeholderTextColor={COLORS.textTertiary}
            multiline
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim()}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-up" size={18} color={input.trim() ? COLORS.white : COLORS.textTertiary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  backArrow: { fontSize: 18, color: COLORS.text },
  navCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  navName: { fontFamily: FONT.serifItalic, fontSize: 17, color: COLORS.text },
  navStatus: { fontFamily: FONT.mono, fontSize: 8, letterSpacing: 1.2, textTransform: 'uppercase', color: COLORS.textTertiary },
  moreBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRule: { height: 1, backgroundColor: COLORS.borderLight, marginHorizontal: SPACING.lg },

  messageList: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: 8,
  },

  bubbleWrap: { marginVertical: 3 },
  bubbleWrapMe:   { alignItems: 'flex-end' },
  bubbleWrapThem: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '78%',
    borderRadius: RADIUS.xl,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMe: {
    backgroundColor: COLORS.accent,
    borderBottomRightRadius: 6,
  },
  bubbleThem: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 6,
  },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe:   { fontFamily: FONT.regular, color: COLORS.white },
  bubbleTextThem: { fontFamily: FONT.regular, color: COLORS.text },
  bubbleTime: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: COLORS.textTertiary,
    marginTop: 3,
    marginHorizontal: 4,
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    paddingBottom: Platform.OS === 'ios' ? SPACING.lg : SPACING.sm,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  composerInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  sendBtnDisabled: {
    backgroundColor: COLORS.border,
  },
});
