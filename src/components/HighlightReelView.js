// ─────────────────────────────────────────────────────────────────────────
// HighlightReelView — read-only horizontal photo strip.
//
// Visual parity with the editing reel on ProfileScreen:
//   - tiles sized so ~5 fit across on desktop / ~2 on phone
//   - bleeds flush to both screen edges (negative side margin)
//   - right-edge fade dissolves the last visible tile to cue "scroll for more"
//   - tap a tile → lightbox (full-screen view, tap to dismiss)
//   - web-only chevron buttons on the left/right for mouse users
//
// Used on MatchDetailScreen to render another profile's photos.
// ProfileScreen has its own version that adds the add/delete affordances —
// we intentionally don't share that one to keep edit logic out of read paths.
// ─────────────────────────────────────────────────────────────────────────

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, RADIUS, SPACING } from '../theme';

const REEL_GAP      = 12;
const REEL_FADE     = 100;
const REEL_TARGET   = 5;
const REEL_TILE_MIN = 140;

function computeTileSize(winWidth) {
  if (winWidth < 800) return REEL_TILE_MIN;
  const usable = winWidth - REEL_FADE;
  return Math.floor(usable / REEL_TARGET) - REEL_GAP;
}

// Walk up the DOM to find the nearest vertically-scrollable ancestor.
// Web only — used to forward vertical wheel events past the horizontal reel.
function findScrollableAncestor(node) {
  let el = node?.parentElement;
  while (el) {
    const oy = window.getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

export default function HighlightReelView({ photos = [], sideInset = SPACING.lg }) {
  const scrollRef = useRef(null);
  const offsetRef = useRef(0);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const { width: winW } = useWindowDimensions();
  const tileSize = computeTileSize(winW);
  const tileStyle = { width: tileSize, height: tileSize };
  const scrollStep = (tileSize + REEL_GAP) * 2;

  // Web: a horizontal ScrollView captures the wheel and translates a vertical
  // scroll into sideways reel movement — so the page won't scroll while the
  // cursor is over the reel. Intercept predominantly-vertical wheels and
  // forward them to the nearest scrollable ancestor instead.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = scrollRef.current?.getScrollableNode?.();
    if (!node) return;
    const handleWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // horizontal intent — keep
      const target = findScrollableAncestor(node);
      if (target) {
        target.scrollTop += e.deltaY;
        e.preventDefault();
      }
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [photos.length]);

  if (!photos?.length) return null;

  const scrollBy = (dx) => {
    const next = Math.max(0, offsetRef.current + dx);
    scrollRef.current?.scrollTo?.({ x: next, animated: true });
  };

  return (
    <View style={[styles.wrap, { marginHorizontal: -sideInset }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => { offsetRef.current = e.nativeEvent.contentOffset.x; }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingLeft: sideInset },
        ]}
      >
        {photos.map((photo, idx) => (
          <TouchableOpacity
            key={photo.id}
            style={[styles.slot, tileStyle]}
            activeOpacity={0.85}
            onPress={() => setLightboxIndex(idx)}
          >
            <Image source={{ uri: photo.url }} style={styles.image} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Right-edge fade — bg color is the page bg so the dissolve looks seamless. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(247,244,239,0)', COLORS.bg]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.fade}
      />

      {/* Web-only arrows */}
      {Platform.OS === 'web' ? (
        <>
          <TouchableOpacity style={[styles.arrow, styles.arrowLeft]}  activeOpacity={0.8} onPress={() => scrollBy(-scrollStep)}>
            <Ionicons name="chevron-back"    size={16} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.arrow, styles.arrowRight]} activeOpacity={0.8} onPress={() => scrollBy(scrollStep)}>
            <Ionicons name="chevron-forward" size={16} color={COLORS.text} />
          </TouchableOpacity>
        </>
      ) : null}

      <PhotoLightbox
        photos={photos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onNav={(i) => setLightboxIndex(i)}
      />
    </View>
  );
}

// ── PhotoLightbox ─────────────────────────────────────────────────────────────
// Full-screen photo viewer with:
//   - Swipe left/right to navigate between photos (outer paginated ScrollView)
//   - Pinch-to-zoom on each photo (inner per-photo ScrollView with maximumZoomScale)
//   - Photo counter pill at bottom
//   - Close button top-right
//   - Web: keyboard arrow + Escape navigation
function PhotoLightbox({ photos, index, onClose, onNav }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const visible = index !== null && index !== undefined;
  const outerRef = useRef(null);

  // Sync the pager to the externally-controlled index (e.g. keyboard arrows on web)
  useEffect(() => {
    if (!visible || !outerRef.current) return;
    outerRef.current.scrollTo({ x: (index ?? 0) * winW, animated: false });
  }, [index, visible]);

  // Keyboard navigation on web
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const hasPrev = index > 0;
    const hasNext = index < photos.length - 1;
    const handleKey = (e) => {
      if (e.key === 'ArrowLeft'  && hasPrev) onNav(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onNav(index + 1);
      if (e.key === 'Escape')               onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, index, photos.length]);

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.lightboxRoot, { width: winW, height: winH }]}>

        {/* ── Outer paginated scroll — swipe left/right to navigate ── */}
        <ScrollView
          ref={outerRef}
          horizontal
          pagingEnabled
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const newIdx = Math.round(e.nativeEvent.contentOffset.x / winW);
            if (newIdx !== index) onNav(newIdx);
          }}
          style={{ width: winW, height: winH }}
        >
          {photos.map((photo) => (
            // ── Inner per-photo scroll — pinch-to-zoom + pan when zoomed ──
            <ScrollView
              key={photo.id}
              style={{ width: winW, height: winH }}
              contentContainerStyle={{
                width: winW,
                height: winH,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              maximumZoomScale={5}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: photo.url }}
                style={{ width: winW, height: winH * 0.88 }}
                resizeMode="contain"
              />
            </ScrollView>
          ))}
        </ScrollView>

        {/* ── Photo counter ── */}
        {photos.length > 1 && (
          <View style={styles.lightboxCounter} pointerEvents="none">
            <Text style={styles.lightboxCounterText}>{(index ?? 0) + 1} / {photos.length}</Text>
          </View>
        )}

        {/* ── Close button ── */}
        <TouchableOpacity style={styles.lightboxClose} activeOpacity={0.8} onPress={onClose}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  scrollContent: {
    paddingRight: REEL_FADE,
    gap: REEL_GAP,
  },
  slot: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },

  fade: {
    position: 'absolute',
    top: 0, bottom: 0, right: 0,
    width: REEL_FADE,
  },

  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  arrowLeft:  { left:  8 },
  arrowRight: { right: 24 },

  lightboxRoot: {
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lightboxClose: {
    position: 'absolute',
    top: 48, right: 20,
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  lightboxCounter: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    zIndex: 10,
  },
  lightboxCounterText: {
    color: '#fff',
    fontFamily: FONT.semiBold,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
