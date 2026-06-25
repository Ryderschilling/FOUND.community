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
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS } from '../theme';
import { supabase } from '../lib/supabase';

// ── Request form modal ────────────────────────────────────────────────────────
function RequestModal({
  visible, onClose,
  reqName, setReqName,
  reqCity, setReqCity,
  reqState, setReqState,
  reqYears, setReqYears,
  submitting, onSubmit,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalCard}>
          {/* Handle */}
          <View style={styles.modalHandle} />

          <Text style={styles.modalTitle}>Request your church</Text>
          <Text style={styles.modalSub}>
            We'll reach out to get them on FOUND so you can connect with other members.
          </Text>

          {/* Church name */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>CHURCH NAME</Text>
            <TextInput
              style={styles.fieldInput}
              value={reqName}
              onChangeText={setReqName}
              placeholder="e.g. Seacoast Church"
              placeholderTextColor={COLORS.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={120}
            />
          </View>

          {/* Location row */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>LOCATION</Text>
            <View style={styles.locationRow}>
              <TextInput
                style={[styles.fieldInput, { flex: 2 }]}
                value={reqCity}
                onChangeText={setReqCity}
                placeholder="City"
                placeholderTextColor={COLORS.textTertiary}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={80}
              />
              <TextInput
                style={[styles.fieldInput, { flex: 1 }]}
                value={reqState}
                onChangeText={(v) => setReqState(v.toUpperCase())}
                placeholder="State"
                placeholderTextColor={COLORS.textTertiary}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={2}
              />
            </View>
          </View>

          {/* Years attended */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>YEARS ATTENDED</Text>
            <TextInput
              style={styles.fieldInput}
              value={reqYears}
              onChangeText={(v) => setReqYears(v.replace(/[^0-9]/g, ''))}
              placeholder="e.g. 3"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="number-pad"
              maxLength={3}
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, (!reqName.trim() || submitting) && { opacity: 0.5 }]}
            activeOpacity={0.85}
            onPress={onSubmit}
            disabled={!reqName.trim() || submitting}
          >
            {submitting
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text style={styles.submitBtnTxt}>Send Request</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.cancelBtn} activeOpacity={0.7}>
            <Text style={styles.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ChurchPicker({
  churchId          = null,
  isHomeChurch      = false,
  churchName        = null,
  lookingForChurch  = null,
  onLookingChange,
  onSaved,
  toast,
}) {
  // ── state — all useState first, then effects ──────────────────────────────
  const [mode, setMode]                     = useState(churchId ? 'done' : 'idle');
  const [selectedChurch, setSelectedChurch] = useState(
    churchId && churchName ? { id: churchId, name: churchName, city: null, state: null } : null
  );
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [modalOpen, setModalOpen]       = useState(false);
  const [reqName, setReqName]           = useState('');
  const [reqCity, setReqCity]           = useState('');
  const [reqState, setReqState]         = useState('');
  const [reqYears, setReqYears]         = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const debounceRef = useRef(null);
  const inputRef    = useRef(null);

  // Sync mode + selectedChurch when parent loads async church data
  useEffect(() => { if (churchId) setMode('done'); }, [churchId]);
  useEffect(() => {
    if (churchId && churchName)
      setSelectedChurch({ id: churchId, name: churchName, city: null, state: null });
  }, [churchId, churchName]);

  // homeSelected is derived directly from the isHomeChurch prop — no local state needed.
  // The parent (EditProfileScreen) owns this value and passes it down after loadData().
  const homeSelected = isHomeChurch;

  // ── search: load all churches immediately, then filter as user types ─────────
  useEffect(() => {
    if (mode !== 'search') return;
    clearTimeout(debounceRef.current);

    setSearching(true);
    // No delay on empty query (initial load), 350ms debounce while typing
    const delay = query.trim() ? 350 : 0;
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_churches', { p_query: query.trim() });
      setResults(data ?? []);
      setSearching(false);
    }, delay);

    return () => clearTimeout(debounceRef.current);
  }, [query, mode]);

  // ── handlers ───────────────────────────────────────────────────────────────
  async function handleHomeChurch() {
    const next = !homeSelected;
    // Optimistic update: tell parent immediately so display reflects the click
    onSaved?.({ churchId: null, isHomeChurch: next });
    setSaving(true);
    const { error } = await supabase.rpc('set_profile_church', {
      p_church_id: null,
      p_is_home_church: next,
    });
    setSaving(false);
    if (error) {
      // Revert parent state on failure
      onSaved?.({ churchId: null, isHomeChurch: !next });
      toast?.({ title: 'Could not save', message: error.message, type: 'error' });
    }
  }

  async function handleSelectChurch(church) {
    setSaving(true);
    const { error } = await supabase.rpc('set_profile_church', { p_church_id: church.id, p_is_home_church: false });
    setSaving(false);
    if (error) {
      toast?.({ title: 'Could not save', message: error.message, type: 'error' });
      return;
    }
    setSelectedChurch(church);
    setHomeSelected(false);
    setMode('done');
    onSaved?.({ churchId: church.id, isHomeChurch: false });
  }

  function openRequestModal() {
    setReqName(query.trim());
    setReqCity('');
    setReqState('');
    setReqYears('');
    setModalOpen(true);
  }

  async function handleSubmitRequest() {
    if (!reqName.trim()) return;
    setSubmitting(true);
    const { data: churchId, error } = await supabase.rpc('submit_church_request', {
      p_name:           reqName.trim(),
      p_city:           reqCity.trim() || null,
      p_state:          reqState.trim() || null,
      p_years_attended: reqYears.trim() ? parseInt(reqYears.trim(), 10) : null,
    });
    setSubmitting(false);
    setModalOpen(false);

    if (!error && churchId) {
      // Profile is now linked to the submitted church — show it as selected.
      const submitted = {
        id:    churchId,
        name:  reqName.trim(),
        city:  reqCity.trim()  || null,
        state: reqState.trim() || null,
      };
      setSelectedChurch(submitted);
      setHomeSelected(false);
      setMode('done');
      onSaved?.({ churchId, isHomeChurch: false });
    } else {
      // RPC returned an error or no ID — fall back to the "request sent" message.
      setRequestSent(true);
    }
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
    const showRequest = !searching && !requestSent && query.trim().length >= 2 && results.length === 0;

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
              Request sent — we'll reach out to them soon.
            </Text>
          </View>
        ) : showRequest ? (
          <TouchableOpacity
            style={styles.requestBtn}
            activeOpacity={0.8}
            onPress={openRequestModal}
          >
            <Ionicons name="add-circle-outline" size={16} color={COLORS.text} />
            <Text style={styles.requestBtnTxt}>Request "{query.trim()}"</Text>
          </TouchableOpacity>
        ) : null}

        {/* Request form modal */}
        <RequestModal
          visible={modalOpen}
          onClose={() => setModalOpen(false)}
          reqName={reqName}     setReqName={setReqName}
          reqCity={reqCity}     setReqCity={setReqCity}
          reqState={reqState}   setReqState={setReqState}
          reqYears={reqYears}   setReqYears={setReqYears}
          submitting={submitting}
          onSubmit={handleSubmitRequest}
        />
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

      <View style={styles.optStack}>
        {/* Find My Church */}
        <TouchableOpacity
          style={styles.optBtn}
          activeOpacity={0.8}
          onPress={enterSearch}
        >
          <View style={styles.optIconWrap}>
            <Ionicons name="search-outline" size={20} color={COLORS.text} />
          </View>
          <View style={styles.optTextWrap}>
            <Text style={styles.optBtnTxt}>Find My Church</Text>
            <Text style={styles.optBtnSub}>Search for my church on FOUND</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
        </TouchableOpacity>

        {/* Home Church — selectable toggle, no navigation */}
        <TouchableOpacity
          style={[styles.optBtn, homeSelected && styles.optBtnActive]}
          activeOpacity={0.8}
          onPress={handleHomeChurch}
          disabled={saving}
        >
          <View style={[styles.optIconWrap, homeSelected && styles.optIconWrapActive]}>
            {saving
              ? <ActivityIndicator size="small" color={homeSelected ? COLORS.white : COLORS.text} />
              : <Ionicons name="home-outline" size={20} color={homeSelected ? COLORS.white : COLORS.text} />
            }
          </View>
          <View style={styles.optTextWrap}>
            <Text style={[styles.optBtnTxt, homeSelected && styles.optBtnTxtActive]}>Home Church</Text>
            <Text style={[styles.optBtnSub, homeSelected && styles.optBtnSubActive]}>
              {homeSelected ? 'Marked — you host a home church' : 'You host a church gathering at your home'}
            </Text>
          </View>
          {homeSelected
            ? <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
            : <View style={{ width: 18 }} />
          }
        </TouchableOpacity>

        {/* Still Searching */}
        <TouchableOpacity
          style={[styles.optBtn, lookingForChurch === true && styles.optBtnActive]}
          activeOpacity={0.8}
          onPress={async () => {
            const next = lookingForChurch === true ? null : true;
            onLookingChange?.(next);
            // If selecting "still searching", also clear church_id via RPC
            // so the user drops off any church's member list immediately
            if (next === true) {
              await supabase.rpc('set_profile_church', { p_church_id: null, p_is_home_church: false });
              onSaved?.({ churchId: null, isHomeChurch: false });
            }
          }}
        >
          <View style={[styles.optIconWrap, lookingForChurch === true && styles.optIconWrapActive]}>
            <Ionicons
              name="compass-outline"
              size={20}
              color={lookingForChurch === true ? COLORS.white : COLORS.text}
            />
          </View>
          <View style={styles.optTextWrap}>
            <Text style={[styles.optBtnTxt, lookingForChurch === true && styles.optBtnTxtActive]}>
              Still Searching
            </Text>
            <Text style={[styles.optBtnSub, lookingForChurch === true && styles.optBtnSubActive]}>
              {lookingForChurch === true ? 'Marked — we\'ll help you find one' : "I\'m looking for a church community"}
            </Text>
          </View>
          {lookingForChurch === true
            ? <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
            : <View style={{ width: 18 }} />
          }
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
  optStack: {
    gap:       SPACING.sm,
    marginTop: SPACING.xs,
  },
  optBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             SPACING.md,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderRadius:    RADIUS.xl,
    borderWidth:     1.5,
    borderColor:     COLORS.border,
    backgroundColor: COLORS.white,
  },
  optBtnActive: {
    backgroundColor: COLORS.text,
    borderColor:     COLORS.text,
  },
  optIconWrap: {
    width:           38,
    height:          38,
    borderRadius:    19,
    backgroundColor: COLORS.surfaceAlt,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  optIconWrapActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  optTextWrap: {
    flex: 1,
    gap:  2,
  },
  optBtnTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   15,
    color:      COLORS.text,
  },
  optBtnTxtActive: {
    color: COLORS.white,
  },
  optBtnSub: {
    fontFamily: FONT.regular,
    fontSize:   12,
    color:      COLORS.textTertiary,
    lineHeight: 16,
  },
  optBtnSubActive: {
    color: 'rgba(255,255,255,0.7)',
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

  // ── request modal ──────────────────────────────────────────────────────────
  modalOverlay: {
    flex:            1,
    justifyContent:  'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingHorizontal: SPACING.lg,
    paddingBottom:     SPACING.xl,
    paddingTop:        SPACING.md,
  },
  modalHandle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: COLORS.border,
    alignSelf:       'center',
    marginBottom:    SPACING.md,
  },
  modalTitle: {
    fontFamily:   FONT.serifRegular,
    fontSize:     22,
    color:        COLORS.text,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  modalSub: {
    fontFamily:   FONT.regular,
    fontSize:     13,
    color:        COLORS.textSecondary,
    lineHeight:   19,
    marginBottom: SPACING.lg,
  },
  fieldBlock: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontFamily:    FONT.mono,
    fontSize:      9,
    letterSpacing: 1.6,
    color:         COLORS.textTertiary,
    marginBottom:  6,
  },
  fieldInput: {
    fontFamily:      FONT.regular,
    fontSize:        15,
    color:           COLORS.text,
    backgroundColor: COLORS.surface,
    borderWidth:     1,
    borderColor:     COLORS.border,
    borderRadius:    RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical:   Platform.OS === 'ios' ? 12 : 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  locationRow: {
    flexDirection: 'row',
    gap:           SPACING.sm,
  },
  submitBtn: {
    backgroundColor: COLORS.text,
    borderRadius:    999,
    paddingVertical: 14,
    alignItems:      'center',
    marginTop:       SPACING.sm,
  },
  submitBtnTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   15,
    color:      COLORS.white,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems:      'center',
  },
  cancelTxt: {
    fontFamily: FONT.semiBold,
    fontSize:   14,
    color:      COLORS.textSecondary,
  },
});
