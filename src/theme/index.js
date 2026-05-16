// ─────────────────────────────────────────────────────────────────
// FOUND Design System — matches found.community website
// Typography stack:
//   Display / H1 / H2 → Georgia (editorial serif, matches site)
//   Body / UI          → Inter (clean, legible)
//   Overlines          → JetBrains Mono (mechanical label contrast)
// ─────────────────────────────────────────────────────────────────

export const COLORS = {
  // ── Backgrounds
  bg: '#F7F4EF',
  surface: '#FFFFFF',
  surfaceAlt: '#EFE9E1',          // matches website "sand" tone

  // ── Text
  text: '#1A1A1A',
  textSecondary: '#6B6560',
  textTertiary: '#A89F97',

  // ── Borders
  border: '#E8E2DA',
  borderLight: '#EFE9E1',

  // ── Primary CTA
  accent: '#1A1A1A',
  accentText: '#FFFFFF',

  // ── Sage — pastel-shifted to match website olive (#7a846a)
  sage: '#7A846A',
  sageBg: '#EFF1EA',
  sageMid: '#B5BFA8',
  sageLight: '#D6DACE',

  // ── Clay — dusty pink-clay, softer than original terracotta
  clay: '#C99880',
  clayBg: '#F7EDE6',

  // ── Gold — honey/sand, less mustard
  gold: '#D6B57E',
  goldBg: '#F7F0E2',

  // ── Utility
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  // ── Tab
  tabActive: '#1A1A1A',
  tabInactive: '#C0B8B0',

  // Legacy aliases
  warm: '#C99880',
  warmBg: '#F7EDE6',
};

// Georgia is built into iOS, macOS, and all major browsers (Expo web).
// On Android it falls back to the platform's default serif, which is a close visual match.
const SERIF = 'Georgia';

export const FONT = {
  serifRegular: SERIF,
  serifItalic:  SERIF, // legacy alias — site design is non-italic; kept to avoid touching every screen
  regular:      'Inter_400Regular',
  medium:       'Inter_500Medium',
  semiBold:     'Inter_600SemiBold',
  bold:         'Inter_700Bold',
  extraBold:    'Inter_800ExtraBold',
  mono:         'JetBrainsMono_400Regular',
};

export const TYPE = {
  display: {
    fontFamily: SERIF,
    fontSize: 44,
    color: '#1A1A1A',
    letterSpacing: -0.5,
    lineHeight: 50,
  },
  h1: {
    fontFamily: SERIF,
    fontSize: 30,
    color: '#1A1A1A',
    letterSpacing: -0.3,
    lineHeight: 36,
  },
  h2: {
    fontFamily: SERIF,
    fontSize: 22,
    color: '#1A1A1A',
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  h3: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#1A1A1A',
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#1A1A1A',
    lineHeight: 23,
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#6B6560',
    lineHeight: 18,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.1,
  },
  overline: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: '#A89F97',
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
};

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 999,
};

export const SHADOW = {
  sm: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 4,
  },
  lg: {
    shadowColor: '#1A1A1A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 28,
    elevation: 8,
  },
};
