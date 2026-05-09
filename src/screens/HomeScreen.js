import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  StatusBar,
  SafeAreaView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING } from '../theme';
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

// Height of the FOUND + bell header block
const HEADER_HEIGHT = 72;

export default function HomeScreen({ navigation }) {
  const [activeFilter, setActiveFilter] = useState('all');
  const matches = MATCHES;

  const headerTranslate = useRef(new Animated.Value(0)).current;
  const lastScrollY    = useRef(0);
  const headerVisible  = useRef(true);

  const handleScroll = ({ nativeEvent }) => {
    const y    = nativeEvent.contentOffset.y;
    const diff = y - lastScrollY.current;

    if (diff > 6 && headerVisible.current) {
      // Scrolling down — slide header out
      headerVisible.current = false;
      Animated.timing(headerTranslate, {
        toValue: -HEADER_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    } else if (diff < -6 && !headerVisible.current) {
      // Scrolling up — slide header back in
      headerVisible.current = true;
      Animated.timing(headerTranslate, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }

    lastScrollY.current = y;
  };

  // Title row + filter chips rendered as the FlatList's list header
  const ListHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>Your Matches</Text>
        <Pill
          label={`${matches.length} nearby`}
          variant="sage"
          style={{ alignSelf: 'flex-end', marginBottom: 4 }}
        />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            active={activeFilter === f.id}
            onPress={() => setActiveFilter(f.id)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />

      {/* ── Sticky header — absolutely positioned so it floats above the list ── */}
      <Animated.View style={[styles.header, { transform: [{ translateY: headerTranslate }] }]}>
        <View>
          <Text style={styles.headerMeta}>30A Area · Friday</Text>
          <Wordmark size="md" />
        </View>
        <IconButton onPress={() => {}}>
          <Ionicons name="notifications-outline" size={18} color={COLORS.text} />
        </IconButton>
      </Animated.View>

      {/* ── Match cards — paddingTop reserves room under the fixed header ── */}
      <FlatList
        data={matches}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
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
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // Absolutely positioned so it overlays the list and can animate out
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.bg,
  },
  headerMeta: {
    fontFamily: FONT.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: COLORS.textTertiary,
    marginBottom: 3,
  },

  // The FlatList's ListHeaderComponent
  listHeader: {
    paddingTop: SPACING.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },

  list: {
    paddingTop: HEADER_HEIGHT,   // content starts below the fixed header
    paddingHorizontal: SPACING.lg,
    paddingBottom: 110,
  },
});
