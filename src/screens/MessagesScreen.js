import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { Avatar, IconButton } from '../components/Atoms';
import { MESSAGES } from '../data/mock';

function MessageRow({ item, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrap}>
        {item.isGroup ? (
          <View style={styles.groupAvatar}>
            <Ionicons name={item.groupIcon ?? 'people-outline'} size={22} color={COLORS.textSecondary} />
          </View>
        ) : (
          <Avatar
            initials={item.initials}
            size={50}
            gradientColors={item.avatarColor ?? [COLORS.sage, COLORS.clay]}
          />
        )}
        {item.online && <View style={styles.onlineDot} />}
      </View>

      <View style={styles.info}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.preview} numberOfLines={1}>{item.preview}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.time}>{item.time}</Text>
        {item.unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unread}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerMeta}>Inbox</Text>
          <Text style={styles.title}>Messages</Text>
        </View>
        <IconButton onPress={() => {}}>
          <Ionicons name="create-outline" size={18} color={COLORS.text} />
        </IconButton>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={15} color={COLORS.textTertiary} />
        <Text style={styles.searchPlaceholder}>Search conversations...</Text>
      </View>

      {/* Connection request banner */}
      <View style={styles.requestBanner}>
        <Text style={styles.requestText}>✦  2 new connection requests</Text>
        <TouchableOpacity><Text style={styles.requestCta}>View →</Text></TouchableOpacity>
      </View>

      <FlatList
        data={MESSAGES}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageRow
            item={item}
            onPress={() => navigation?.navigate('Chat', { thread: item })}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  headerMeta: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 3,
  },
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
  },
  searchPlaceholder: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.textTertiary,
  },

  requestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.sageBg,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: COLORS.sageLight,
  },
  requestText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.sage },
  requestCta:  { fontFamily: FONT.bold,     fontSize: 13, color: COLORS.sage },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 13,
  },
  avatarWrap: { position: 'relative', flexShrink: 0 },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: RADIUS.full,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: COLORS.bg,
  },
  info: { flex: 1, gap: 3, minWidth: 0 },
  name:    { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  preview: { fontFamily: FONT.regular,  fontSize: 13, color: COLORS.textSecondary },
  right: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  time:  { fontFamily: FONT.regular, fontSize: 11, color: COLORS.textTertiary },
  badge: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.full,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: 11, fontFamily: FONT.bold },
  separator: { height: 1, backgroundColor: COLORS.borderLight, marginLeft: 78 },
});
