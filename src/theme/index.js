// ─────────────────────────────────────────────────────────────────
// FOUND Design System — Editorial / warm-cream aesthetic
// Typography stack:
//   Display / H1 / H2 → Instrument Serif italic (editorial feel)
//   Body / UI          → Inter (clean, legible)
//   Overlines          → JetBrains Mono (mechanical label contrast)
// ─────────────────────────────────────────────────────────────────

export const COLORS = {
  // ── Backgrounds
  bg: '#F7F4EF',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EBE3',

  // ── Text
  text: '#1A1A1A',
  textSecondary: '#6B6560',
  textTertiary: '#A89F97',

  // ── Borders
  border: '#E8E2DA',
  borderLight: '#F0EBE3',

  // ── Primary CTA
  accent: '#1A1A1A',
  accentText: '#FFFFFF',

  // ── Sage (match score, success)
  sage: '#5A7A4A',
  sageBg: '#EDF3EA',
  sageMid: '#A8C49A',
  sageLight: '#C8DEC0',

  // ── Clay / terracotta
  clay: '#B87155',
  clayBg: '#FBF0EA',

  // ── Gold
  gold: '#C9994A',
  goldBg: '#FBF5EA',

  // ── Utility
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  // ── Tab
  tabActive: '#1A1A1A',
  tabInactive: '#C0B8B0',

  // Legacy aliases
  warm: '#B87155',
  warmBg: '#FBF0EA',
};

export const FONT = {
  serifRegular: 'InstrumentSerif_400Regular',
  serifItalic:  'InstrumentSerif_400Regular_Italic',
  regular:      'Inter_400Regular',
  medium:       'Inter_500Medium',
  semiBold:     'Inter_600SemiBold',
  bold:         'Inter_700Bold',
  extraBold:    'Inter_800ExtraBold',
  mono:         'JetBrainsMono_400Regular',
};

export const TYPE = {
  display: {
    fontFamily: 'InstrumentSerif_400Regular_Italic',
    fontSize: 44,
    color: '#1A1A1A',
    letterSpacing: -0.5,
    lineHeight: 50,
  },
  h1: {
    fontFamily: 'InstrumentSerif_400Regular_Italic',
    fontSize: 30,
    color: '#1A1A1A',
    letterSpacing: -0.3,
    lineHeight: 36,
  },
  h2: {
    fontFamily: 'InstrumentSerif_400Regular_Italic',
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
