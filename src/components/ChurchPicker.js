/**
 * ChurchPicker — church selection UI used in Onboarding + EditProfile.
 *
 * Modes:
 *   idle     → question + two buttons (Home Church / Find My Church)
 *   search   → search input + results from search_churches RPC
 *              no match after 3+ chars → "Request [name]" button
 *   done     → shows selected church or Home Church, with a Change link
 *
 * DB writes happen immediately inside this component — the parent doesn't
 * need to do anything extra. onSaved fires after each successful commit.
 *
 * Props:
 *   churchId      uuid | null   — current church_id from profile
 *   isHomeChurch  boolean       — current is_home_church from profile
 *   churchName    string | null — display name for current church (if any)
 *   onSaved       ({ churchId, isHomeChurch }) => void   — optional callback
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';

export default function ChurchPicker({
  churchId     = null,
  isHomeChurch = false,
  churchName   = null,
  onSaved,
}) {
  // ── state ──────────────────────────────────────────────────────────────────
  const initialMode = (isHomeChurch || churchId) ? 'done' : 'idle';

  const [mode, setMode]                   = useState(initialMode);
  const [selectedChurch, setSelectedChurch] = useState(
    churchId && churchName ? { id: churchId, name: churchName, city: null, state: null } : null
  );
  const [homeSelected, setHomeSelected]   = useState(isHomeChurch);

  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const debounceRef = useRef(null);
  const inputRef    = useRef(null);

  // ── search debounce ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'search') return;
    clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_churches', { p_query: query.trim() });
      setResults(data ?? []);
      setSearching(false);
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [query, mode]);

  // ── handlers ───────────────────────────────────────────────────────────────
  async function handleHomeChurch() {
    setSaving(true);
    await supabase.rpc('set_profile_church', { p_church_id: null, p_is_home_church: true });
    setSaving(false);
    setHomeSelected(true);
    setSelectedChurch(null);
    setMode('done');
    onSaved?.({ churchId: null, isHomeChurch: true });
  }

  async function handleSelectChurch(church) {
    setSaving(true);
    await supabase.rpc('set_profile_church', { p_church_id: church.id, p_is_home_church: false });
    setSaving(false);
    setSelectedChurch(church);
    setHomeSelected(false);
    setMode('done');
    onSaved?.({ churchId: church.id, isHomeChurch: false });
  }

  async function handleRequest() {
    if (!query.trim()) return;
    setRequesting(true);
    await supabase.rpc('submit_church_request', { p_name: query.trim() });
    setRequesting(false);
    setRequestSent(true);
  }

  function handleChange() {
    setMode('idle');
    setQuery('');
    setResults([]);
    setRequestSent(false);
    setSearching(false);
  }

  function enterSearch() {
    setMode('search');
    setRequestSent(false);
    // Small delay so the modal/scroll settles before focusing
    setTimeout(() => inputRef.current?.focus(), 120);
  }

  // ── render: done ───────────────────────────────────────────────────────────
  if (mode === 'done') {
    return (
      <View style={styles.doneCard}>
        <View style={styles.doneRow}>
          <View style={styles.doneIcon}>
            <Ionicons
              name={homeSelected ? 'home-outline' : 'business-outline'}
              size={16}
              color={COLORS.text}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.doneName}>
              {homeSelected ? 'Home Church' : selectedChurch?.name ?? 'Church linked'}
            </Text>
            {!homeSelected && (selectedChurch?.city || selectedChurch?.state) ? (
              <Text style={styles.doneMeta}>
                {[selectedChurch.city, selectedChurch.state].filter(Boolean).join(', ')}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={handleChange} activeOpacity={0.7} hitSlop={8}>
            <Text style={styles.changeTxt}>Change</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── render: search ─────────────────────────────────────────────────────────
  if (mode === 'search') {
    const showRequest = !searching && !requestSent && query.trim().length >= 3 && results.length === 0;

    return (
      <View>
        {/* Search row */}
        <View style={styles.searchRow}>
          <TouchableOpacity
            onPress={() => { setMode('idle'); setQuery(''); setResults([]); }}
            activeOpacity={0.7}
            style={styles.backBtn}
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={15} color={COLORS.textTertiary} />
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Type your church name…"
              placeholderTextColor={COLORS.textTertiary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              {...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null)}
            />
            {searching
              ? <ActivityIndicator size="small" color={COLORS.textTertiary} />
              : query.length > 0
                ? (
                  <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
                  </TouchableOpacity>
                )
              : null
            }
          </View>
        </View>

        {/* Results */}
        {results.map((church) => (
          <TouchableOpacity
            key={church.id}
            style={styles.resultRow}
            activeOpacity={0.75}
            onPress={() => handleSelectChurch(church)}
            disabled={saving}
          >
            <View style={styles.resultIcon}>
              <Ionicons name="business-outline" size={15} color={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{church.name}</Text>
              {church.city ? (
                <Text style={styles.resultMeta}>
                  {[church.city, church.state].filter(Boolean).join(', ')}
                </Text>
              ) : null}
            </View>
            {saving
              ? <ActivityIndicator size="small" color={COLORS.textTertiary} />
              : <Ionicons name="chevron-forward" size={14} color={COLORS.textTertiary} />
            }
          </TouchableOpacity>
        ))}

        {/* Request if no match */}
        {requestSent ? (
          <View style={styles.requestSentRow}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.sage} />
            <Text style={styles.requestSentTxt}>
              Request sent for "{query.trim()}" — we'll reach out to them soon.
            </Text>
          </View>
        ) : showRequest ? (
          <TouchableOpacity
            style={styles.requestBtn}
            activeOpacity={0.8}
            onPress={handleRequest}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={16} color={COLORS.text} />
                <Text style={styles.requestBtnTxt}>Request "{query.trim()}"</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // ── render: idle ───────────────────────────────────────────────────────────
  return (
    <View style={styles.idleWrap}>
      <Text style={styles.question}>Do you attend a local church you love?</Text>
      <Text style={styles.sub}>
        Enter your church name and we'll reach out to get them on FOUND — so you can connect with other members.
      </Text>

      <View style={styles.optRow}>
        {/* Home Church */}
        <TouchableOpacity
          style={styles.optBtn}
          activeOpacity={0.8}
          onPress={handleHomeChurch}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.text} />
          ) : (
            <>
              <Ionicons name="home-outline" size={18} color={COLORS.text} />
              <Text style={styles.optBtnTxt}>Home Church</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Find My Church */}
        <TouchableOpacity
          style={styles.optBtn}
          activeOpacity={0.8}
          onPress={enterSearch}
        >
          <Ionicons name="search-outline" size={18} color={COLORS.text} />
          <Text style={styles.optBtnTxt}>Find My Church</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── idle ──────────────────────────────────────────────────────────────────
  idleWrap: {
    gap: SPACING.md,
  },
  question: {
    fontFamily:   FONT.serifRegular,
    fontSize:     17,
    color:        COLORS.text,
    letterSpacing: -0.2,
    lineHeight:   24,
  },
  sub: {
    fontFamily: FONT.regular,
    fontSize:   13,
    color:      COLORS.textSecondary,
    lineHeight: 19,
  },
  optRow: {
    flexDirection: 'row',
    gap:           SPACING.sm,
    marginTop:     SPACING.xs,
  },
  optBtn: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    paddingVertical: 12,
    borderRadius:    RADIUS.md,
    borderWidth:     1,
    borderColor:     COLORS.border,
    backgroundColor: COLORS.white,
  },
  optBtnTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   13,
    color:      COLORS.text,
  },

  // ── search ─────────────────────────────────────────────────────────────────
  searchRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.sm,
    marginBottom:  SPACING.sm,
  },
  backBtn: {
    width:           32,
    height:          32,
    borderRadius:    16,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: COLORS.surface,
    borderWidth:     1,
    borderColor:     COLORS.border,
  },
  searchBox: {
    flex:            1,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    backgroundColor: COLORS.surface,
    borderRadius:    999,
    borderWidth:     1,
    borderColor:     COLORS.border,
    paddingHorizontal: 12,
    paddingVertical:   Platform.OS === 'web' ? 8 : 9,
  },
  searchInput: {
    flex:       1,
    fontFamily: FONT.regular,
    fontSize:   14,
    color:      COLORS.text,
    padding:    0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },

  resultRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             SPACING.sm,
    paddingVertical: 11,
    borderTopWidth:  1,
    borderTopColor:  COLORS.borderLight,
  },
  resultIcon: {
    width:           30,
    height:          30,
    borderRadius:    15,
    backgroundColor: COLORS.surface,
    borderWidth:     1,
    borderColor:     COLORS.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  resultName: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.text,
  },
  resultMeta: {
    fontFamily: FONT.regular,
    fontSize:   12,
    color:      COLORS.textTertiary,
    marginTop:  1,
  },

  requestBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    marginTop:       SPACING.md,
    paddingVertical: 12,
    borderRadius:    RADIUS.md,
    borderWidth:     1,
    borderColor:     COLORS.border,
    borderStyle:     'dashed',
    backgroundColor: COLORS.surface,
  },
  requestBtnTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   13,
    color:      COLORS.text,
  },

  requestSentRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.sm,
    marginTop:     SPACING.md,
    padding:       SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius:    RADIUS.md,
    borderWidth:     1,
    borderColor:     COLORS.border,
  },
  requestSentTxt: {
    flex:       1,
    fontFamily: FONT.regular,
    fontSize:   13,
    color:      COLORS.textSecondary,
    lineHeight: 18,
  },

  // ── done ───────────────────────────────────────────────────────────────────
  doneCard: {
    backgroundColor: COLORS.surface,
    borderRadius:    RADIUS.md,
    borderWidth:     1,
    borderColor:     COLORS.border,
    padding:         SPACING.md,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           SPACING.sm,
  },
  doneIcon: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: COLORS.white,
    borderWidth:     1,
    borderColor:     COLORS.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  doneName: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.text,
  },
  doneMeta: {
    fontFamily: FONT.regular,
    fontSize:   12,
    color:      COLORS.textTertiary,
    marginTop:  1,
  },
  changeTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   13,
    color:      COLORS.textSecondary,
  },
});
