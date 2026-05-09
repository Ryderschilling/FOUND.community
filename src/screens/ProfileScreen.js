import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { Avatar, Pill, SectionHeader } from '../components/Atoms';
import { CURRENT_USER } from '../data/mock';

function StatCard({ value, label }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SettingsItem({ iconName, label, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.settingsItem} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.settingsIconWrap}>
        <Ionicons name={iconName} size={18} color={danger ? '#C0392B' : COLORS.textSecondary} />
      </View>
      <Text style={[styles.settingsLabel, danger && styles.settingsDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const user = CURRENT_USER;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={styles.headerMeta}>Your Account</Text>
          <Text style={styles.pageTitle}>Profile</Text>
        </View>

        {/* Hero card */}
        <View style={styles.heroCard}>
          <Avatar initials={user.initials} size={68} gradientColors={user.avatarColor} />
          <View style={styles.heroInfo}>
            <Text style={styles.heroName}>{user.name}</Text>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={12} color={COLORS.textSecondary} />
              <Text style={styles.heroLocation}>{user.location}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.editBtn}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>

          {/* Stats */}
          <View style={styles.statsRow}>
            <StatCard value={user.matchCount}      label="Matches"   />
            <StatCard value={user.connectionCount} label="Connected" />
            <StatCard value={user.groupCount}      label="Groups"    />
          </View>

          {/* Life stage */}
          <View style={styles.section}>
            <SectionHeader label="Life Stage" />
            <View style={styles.lifeStageCard}>
              <Ionicons name={user.lifeStage.icon} size={20} color={user.lifeStage.iconColor ?? COLORS.textSecondary} />
              <Text style={styles.lifeStageText}>{user.lifeStage.label}</Text>
            </View>
          </View>

          {/* Interests */}
          <View style={styles.section}>
            <SectionHeader label="Interests" action="Edit" />
            <View style={styles.pillsWrap}>
              {user.interests.map((i) => (
                <Pill key={i.id} label={i.label} variant="neutral" />
              ))}
            </View>
          </View>

          {/* Church */}
          <View style={styles.section}>
            <SectionHeader label="Church" />
            <View style={styles.churchCard}>
              <View style={styles.churchIconWrap}>
                <Ionicons name="business-outline" size={22} color={COLORS.sage} />
              </View>
              <View>
                <Text style={styles.churchName}>{user.church.name}</Text>
                <Text style={styles.churchMeta}>{user.church.distance} away · Member</Text>
              </View>
            </View>
          </View>

          {/* Settings */}
          <View style={styles.section}>
            <SectionHeader label="Settings" />
            <View style={styles.settingsGroup}>
              <SettingsItem iconName="notifications-outline" label="Notifications"       />
              <SettingsItem iconName="location-outline"      label="Location Settings"   />
              <SettingsItem iconName="lock-closed-outline"   label="Privacy"             />
              <SettingsItem iconName="business-outline"      label="My Church Dashboard" />
              <SettingsItem iconName="help-circle-outline"   label="Help & Support"      />
              <SettingsItem iconName="log-out-outline"       label="Sign Out" danger      />
            </View>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  pageHeader: {
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
  pageTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  heroInfo: { flex: 1, gap: 3 },
  heroName: { fontFamily: FONT.serifItalic, fontSize: 20, color: COLORS.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroLocation: { fontFamily: FONT.regular, fontSize: 13, color: COLORS.textSecondary },
  editBtn: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  editBtnText: { fontFamily: FONT.semiBold, fontSize: 13, color: COLORS.textSecondary },

  content: { paddingHorizontal: SPACING.lg, gap: SPACING.lg },

  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.sm,
  },
  statValue: { fontFamily: FONT.serifItalic, fontSize: 28, color: COLORS.text },
  statLabel: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginTop: 2,
  },

  section: { gap: SPACING.sm },

  lifeStageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lifeStageText: { fontFamily: FONT.medium, fontSize: 15, color: COLORS.text },

  pillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  churchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  churchIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.sageBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  churchName: { fontFamily: FONT.semiBold, fontSize: 15, color: COLORS.text },
  churchMeta: { fontFamily: FONT.regular, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  settingsGroup: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    ...SHADOW.sm,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  settingsIconWrap: { width: 24, alignItems: 'center' },
  settingsLabel: { fontFamily: FONT.regular, fontSize: 15, color: COLORS.text, flex: 1 },
  settingsDanger: { color: '#C0392B' },
});
