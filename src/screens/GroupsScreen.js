import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  StatusBar,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, TYPE, SPACING, RADIUS, SHADOW } from '../theme';
import GroupCard from '../components/GroupCard';
import { SectionHeader, PrimaryButton, GhostButton } from '../components/Atoms';
import { GROUPS } from '../data/mock';

export default function GroupsScreen() {
  const sections = [
    { title: 'JOINED', data: GROUPS.joined },
    { title: 'SUGGESTED FOR YOU', data: GROUPS.suggested },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
            <GroupCard
              group={item}
              onJoin={() => {}}
              onPress={() => {}}
            />
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderWrap}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Meta overline */}
            <Text style={styles.headerMeta}>Local Community</Text>
            {/* Serif title */}
            <Text style={styles.title}>Groups</Text>
            <Text style={styles.sub}>Find your people — in real life</Text>

            {/* Create group CTA */}
            <TouchableOpacity style={styles.createBtn} activeOpacity={0.8}>
              <Ionicons name="add" size={15} color={COLORS.text} />
              <Text style={styles.createBtnText}>Create a Group</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  listContent: { paddingBottom: 110 },

  header: {
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
    marginBottom: 4,
  },
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
    lineHeight: 36,
  },
  sub: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: SPACING.md,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    ...SHADOW.sm,
  },
  createBtnText: {
    fontFamily: FONT.semiBold,
    fontSize: 13,
    color: COLORS.text,
  },

  sectionHeaderWrap: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
  },

  cardWrap: {
    paddingHorizontal: SPACING.lg,
    marginBottom: 10,
  },
});
