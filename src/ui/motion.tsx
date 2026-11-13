import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Keyboard, LayoutAnimation, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Motion, used sparingly. Controls give a little under the finger and spring
 * back; things that change size or place ease there instead of jumping.
 * Everything finishes inside 300ms, and screens people see many times a day
 * do not animate on arrival.
 */

const native = Platform.OS !== 'web';

/** A control that squashes slightly while pressed and springs back with a small overshoot. */
export function usePressScale(to = 0.96) {
  const [scale] = useState(() => new Animated.Value(1));
  const spring = (value: number, bounciness: number) => Animated.spring(scale, { toValue: value, useNativeDriver: native, speed: 40, bounciness }).start();
  return {
    style: { transform: [{ scale }] },
    onPressIn: () => spring(to, 0),
    onPressOut: () => spring(1, 10),
  };
}

/** Ease the next layout change (a row leaving, a section opening) instead of snapping. iPhone and iPad only. */
export function easeNextLayout(duration = 220) {
  if (Platform.OS !== 'ios') return;
  LayoutAnimation.configureNext({
    duration,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/** A value that eases to its target, starting fast and settling, for bars that fill. */
export function useEased(target: number, duration = 280): Animated.Value {
  const [value] = useState(() => new Animated.Value(target));
  useEffect(() => {
    Animated.timing(value, { toValue: target, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [target, duration, value]);
  return value;
}

/** Drops in from above with a slight overshoot, as a banner does. */
export function DropIn({ children }: { children: ReactNode }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: native, speed: 18, bounciness: 9 }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** True when the person has asked the system to reduce motion. Movement is then skipped, not just shortened. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => subscription.remove();
  }, []);
  return reduced;
}

/**
 * Keeps its contents clear of the keyboard. Use it for things that reach the
 * bottom of the screen: pushed screens and sheets. It pads by the height of
 * the keyboard itself, which does not depend on where the view sits, so it is
 * right inside a sheet presented part-way down the screen, where measuring the
 * view's own position is not.
 *
 * `bottomInset` is space the contents already leave at the bottom for the home
 * indicator. The keyboard covers that, so it is not added twice.
 */
export function KeyboardAvoider({ children, style, bottomInset = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottomInset?: number }) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // Android resizes the window for the keyboard itself, and browsers handle their own.
    if (Platform.OS !== 'ios') return;
    const apply = (next: number, duration: number) => {
      LayoutAnimation.configureNext({ duration: Math.max(duration, 160), update: { type: LayoutAnimation.Types.keyboard } });
      setInset(next);
    };
    const changed = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const covered = Dimensions.get('screen').height - event.endCoordinates.screenY;
      apply(Math.max(0, covered - bottomInset), event.duration ?? 250);
    });
    const hidden = Keyboard.addListener('keyboardWillHide', (event) => apply(0, event.duration ?? 250));
    return () => {
      changed.remove();
      hidden.remove();
    };
  }, [bottomInset]);

  return <View style={[style, { paddingBottom: inset }]}>{children}</View>;
}
