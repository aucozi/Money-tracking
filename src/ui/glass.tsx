import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { continuous, useTheme } from './theme';

function detect(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

/** True on iPhones that can draw Apple's Liquid Glass material (iOS 26 and later). */
export const hasLiquidGlass = detect();

/**
 * A surface for the floating control layer: bars, round buttons, sheets, toasts.
 * It is the real system material where the phone has it. Elsewhere it is a
 * translucent stand-in, blurred in browsers that can.
 *
 * Glass is for controls that sit above content. Content itself (cards, rows)
 * stays opaque, and glass is never stacked on glass.
 */
export function Glass({
  children,
  style,
  tint,
  interactive,
  testID,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tint the material, for the one control that is the primary action. */
  tint?: string;
  /** Let the material respond to touch, as buttons do. */
  interactive?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  if (hasLiquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" tintColor={tint} isInteractive={interactive} style={[continuous, style]} testID={testID}>
        {children}
      </GlassView>
    );
  }
  return (
    <View
      testID={testID}
      style={[
        styles.fallback,
        continuous,
        { backgroundColor: tint ?? c.glass, borderColor: tint ? 'transparent' : c.glassBorder },
        Platform.OS === 'web' && !tint ? (webBlur as ViewStyle) : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const webBlur = { backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)' };

const styles = StyleSheet.create({
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
});
