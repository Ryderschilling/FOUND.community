import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import PersonCard from '../components/PersonCard';
import { Wordmark, Chip, Pill, IconButton } from '../components/Atoms';
import { MATCHES } from '../data/mock';

const FILTERS = [
  { id: 'all',    label: 'All'         },
  { id: 'near',   label: 'Near Me'     },
  { id: 'stage',  label: 'Life Stage'  },
  { id: 'church', label: 'Same Church' },
  { id: 'new',    label: 'New'         },
];

export default function HomeScreen({ navigation }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const matches = MATCHES;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerMeta}>30A Area · Friday</Text>
          <Wordmark size="md" />
        </View>
        <IconButton onPress={() => {}}>
          <Ionicons name="notifications-outline" size={18} color={COLORS.text} />
        </IconButton>
      </View>

      {/* Page title + count */}
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>Your Matches</Text>
        <Pill label={`${matches.length} nearby`} variant="sage" />
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterWrap}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            active={activeFilter === f.id}
            onPress={() => setActiveFilter(f.id)}
          />
        ))}
      </ScrollView>

      {/* Match cards */}
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PersonCard
            match={item}
            onConnect={() => {}}
            onWave={() => {}}
            onPress={() => navigation?.navigate('MatchDetail', { match: item })}
          />
        )}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        showsVerticalScrollIndicator={false}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  pageTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 30,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  filterWrap: { flexGrow: 0, marginBottom: SPACING.md, overflow: 'visible' },
  filterRow: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 4,
    gap: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: 110,
  },
});
