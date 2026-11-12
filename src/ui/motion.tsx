import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, LayoutAnimation, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

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

/**
 * Keeps its contents clear of the keyboard. It measures where it actually sits
 * on screen, so it is right inside sheets and pushed screens, where a fixed
 * offset is not.
 */
export function KeyboardAvoider({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // Android resizes the window for the keyboard itself, and browsers handle their own.
    if (Platform.OS !== 'ios') return;
    const apply = (next: number, duration: number) => {
      LayoutAnimation.configureNext({ duration: Math.max(duration, 160), update: { type: LayoutAnimation.Types.keyboard } });
      setInset(next);
    };
    const changed = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      ref.current?.measureInWindow((_x, y, _width, height) => {
        apply(Math.max(0, y + height - event.endCoordinates.screenY), event.duration ?? 250);
      });
    });
    const hidden = Keyboard.addListener('keyboardWillHide', (event) => apply(0, event.duration ?? 250));
    return () => {
      changed.remove();
      hidden.remove();
    };
  }, []);

  return (
    <View ref={ref} style={[style, { paddingBottom: inset }]}>
      {children}
    </View>
  );
}
