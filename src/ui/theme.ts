import { useColorScheme } from 'react-native';

import { useStore } from '@/store/store';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
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
}

const light: Palette = {
  bg: '#F5F3EE',
  surface: '#FFFFFF',
  surfaceAlt: '#EDEAE3',
  border: '#E2DED5',
  text: '#17201E',
  textMuted: '#5B6663',
  textFaint: '#8C9592',
  accent: '#0F766E',
  accentSoft: '#D5EEEA',
  onAccent: '#FFFFFF',
  positive: '#15803D',
  positiveSoft: '#DCF3E3',
  negative: '#B91C1C',
  negativeSoft: '#FBE3E1',
  warning: '#B45309',
  warningSoft: '#FCEBCF',
  overlay: 'rgba(15, 23, 21, 0.45)',
};

const dark: Palette = {
  bg: '#0C1110',
  surface: '#151C1A',
  surfaceAlt: '#1E2725',
  border: '#27322F',
  text: '#ECF1EF',
  textMuted: '#A3AFAB',
  textFaint: '#74807C',
  accent: '#2DD4BF',
  accentSoft: '#12332F',
  onAccent: '#06201D',
  positive: '#4ADE80',
  positiveSoft: '#12301D',
  negative: '#F87171',
  negativeSoft: '#3A1919',
  warning: '#FBBF24',
  warningSoft: '#3A2C0C',
  overlay: 'rgba(0, 0, 0, 0.6)',
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
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
