/**
 * Alerts Command - Design System
 * Webull-inspired palette: mint-teal bullish / rose bearish
 */

export const colors = {
  // Backgrounds
  bg: '#000000',
  surface: '#0C0C0E',
  surfaceElevated: '#141416',
  surfaceHover: '#1A1A1E',

  // Borders
  border: '#1C1C20',
  borderSubtle: '#141418',
  borderAccent: 'rgba(0, 212, 160, 0.22)',

  // Primary accent — Webull-style mint teal (bullish)
  green: '#00D4A0',
  greenDim: '#00A87E',
  greenBg: 'rgba(0, 212, 160, 0.10)',
  greenBgStrong: 'rgba(0, 212, 160, 0.18)',

  // Semantic — Webull-style rose (bearish)
  red: '#F5466B',
  redDim: '#D63B58',
  redBg: 'rgba(245, 70, 107, 0.10)',
  redBgStrong: 'rgba(245, 70, 107, 0.18)',
  yellow: '#FFD60A',
  yellowBg: 'rgba(255, 214, 10, 0.10)',
  blue: '#0A84FF',
  blueBg: 'rgba(10, 132, 255, 0.10)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A8',
  textTertiary: '#606068',
  textMuted: '#404048',

  // Sentiment
  bullish: '#00D4A0',
  bearish: '#F5466B',
  neutral: '#A0A0A8',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 100,
};

export const typography = {
  hero: { fontSize: 32, fontWeight: '800' as const, letterSpacing: 0.5 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: 0.3 },
  heading: { fontSize: 18, fontWeight: '700' as const },
  subheading: { fontSize: 15, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '600' as const },
  micro: { fontSize: 10, fontWeight: '700' as const, letterSpacing: 0.8 },
};

export const shadows = {
  glow: {
    shadowColor: colors.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
};

// Section header with "⟩" prefix styling
export const sectionStyle = {
  prefix: '⟩',
  gap: 8,
};
