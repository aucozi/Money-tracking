import { Platform, useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

import { useStore } from '@/store/store';

/**
 * The look follows Apple's current design language: calm, opaque content on a
 * grouped background, with controls and navigation floating above it on glass.
 * Colour is used sparingly, for the primary action and for meaning.
 */
export interface Palette {
  /** The grouped background behind everything. */
  bg: string;
  /** Cards and rows: the content layer. */
  surface: string;
  /** Fills inside content: tracks, wells, secondary buttons. */
  surfaceAlt: string;
  /** Hairlines between rows. */
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  overlay: string;
  /** Stand-in for glass where the real material is unavailable. */
  glass: string;
  glassBorder: string;
}

const light: Palette = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEBF0',
  border: '#D8D8DE',
  text: '#0B0B0F',
  textMuted: '#55555E',
  textFaint: '#85858E',
  accent: '#0A7F74',
  accentSoft: '#DDF3EF',
  onAccent: '#FFFFFF',
  positive: '#1A8239',
  positiveSoft: '#DFF5E5',
  negative: '#D1242F',
  negativeSoft: '#FDE5E6',
  warning: '#A85400',
  warningSoft: '#FFEFD6',
  overlay: 'rgba(0, 0, 0, 0.32)',
  glass: 'rgba(250, 250, 252, 0.78)',
  glassBorder: 'rgba(255, 255, 255, 0.9)',
};

const dark: Palette = {
  bg: '#000000',
  surface: '#1C1C1E',
  surfaceAlt: '#2C2C2E',
  border: '#38383C',
  text: '#F5F5F7',
  textMuted: '#AEAEB6',
  textFaint: '#7C7C84',
  accent: '#3DDBC4',
  accentSoft: '#0F3530',
  onAccent: '#00201C',
  positive: '#32D45F',
  positiveSoft: '#10321B',
  negative: '#FF5A52',
  negativeSoft: '#3D1614',
  warning: '#FFA826',
  warningSoft: '#3B2A08',
  overlay: 'rgba(0, 0, 0, 0.55)',
  glass: 'rgba(44, 44, 48, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.14)',
};

export interface Theme {
  dark: boolean;
  c: Palette;
}

export const palettes = { light, dark };

/** The palette in force: the person's choice in Settings, or the device setting. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = useStore((state) => state.data.settings.theme);
  const isDark = preference === 'system' ? system === 'dark' : preference === 'dark';
  return { dark: isDark, c: isDark ? dark : light };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * Corner radii nest: a shape inside another uses the outer radius minus the
 * padding between them, so the curves stay concentric.
 */
export const radius = { sm: 10, md: 14, lg: 24, xl: 34, pill: 999 } as const;

/** Apple's continuous ("squircle") corner, where the platform supports it. */
export const continuous: ViewStyle = Platform.OS === 'ios' ? { borderCurve: 'continuous' } : {};

/** Rounded numerals for money, as in Wallet and Fitness. Other platforms keep their own figures. */
export const roundedFont: TextStyle =
  Platform.OS === 'ios'
    ? { fontFamily: 'ui-rounded' }
    : Platform.OS === 'web'
      ? { fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }
      : {};

/** Room that floating controls need at the bottom of a tab screen on the web, where the tab bar is drawn by the app. */
export const WEB_TAB_BAR_SPACE = Platform.OS === 'web' ? 76 : 0;
