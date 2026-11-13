import { useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { haptic } from '@/platform/haptics';

import { Icon, type IconName } from './icon';
import { T } from './primitives';

export interface SwipeAction {
  label: string;
  icon: IconName;
  /** Background of the action; the icon and label are drawn in `onColor`. */
  color: string;
  onColor: string;
  onPress: () => void;
  testID?: string;
}

const ACTION_WIDTH = 76;

// Only one row stays open at a time, as in Mail: opening another closes the last.
let openRow: SwipeableMethods | null = null;

/** Close whichever row is showing its actions, e.g. before the list changes. */
export function closeOpenSwipe() {
  openRow?.close();
  openRow = null;
}

function Actions({ actions, methods, progress }: { actions: SwipeAction[]; methods: SwipeableMethods; progress: SharedValue<number> }) {
  // Hidden until the row moves: otherwise their colour shows as a fringe around the row's rounded corners.
  const shown = useAnimatedStyle(() => ({ opacity: progress.value > 0 ? 1 : 0 }));
  return (
    <Animated.View style={[styles.actions, shown]}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testID}
          onPress={() => {
            methods.close();
            action.onPress();
          }}
          style={[styles.action, { backgroundColor: action.color }]}
        >
          <Icon name={action.icon} size={22} color={action.onColor} />
          <T variant="caption" weight="600" numberOfLines={1} style={{ color: action.onColor }}>
            {action.label}
          </T>
        </Pressable>
      ))}
    </Animated.View>
  );
}

/**
 * A list row with actions behind it. Dragging right carries out `swipeRight`
 * straight away, the way Mail marks a message read; dragging left uncovers
 * the `trailing` buttons. Every action must also be reachable another way,
 * since a swipe is invisible until it is tried.
 */
export function SwipeRow({
  children,
  swipeRight,
  trailing = [],
  enabled = true,
  backgroundColor,
}: {
  children: ReactNode;
  swipeRight?: SwipeAction;
  trailing?: SwipeAction[];
  enabled?: boolean;
  /** Painted behind the row itself, so the actions never show through it. */
  backgroundColor: string;
}) {
  const row = useRef<SwipeableMethods | null>(null);
  if (!swipeRight && trailing.length === 0) return <View style={{ backgroundColor }}>{children}</View>;

  return (
    <Swipeable
      ref={row}
      enabled={enabled}
      friction={1.6}
      overshootFriction={8}
      leftThreshold={ACTION_WIDTH * 0.6}
      rightThreshold={ACTION_WIDTH * 0.6}
      childrenContainerStyle={{ backgroundColor }}
      renderLeftActions={swipeRight ? (progress, _translation, methods) => <Actions actions={[swipeRight]} methods={methods} progress={progress} /> : undefined}
      renderRightActions={
        trailing.length > 0 ? (progress, _translation, methods) => <Actions actions={trailing} methods={methods} progress={progress} /> : undefined
      }
      onSwipeableWillOpen={() => {
        if (openRow && openRow !== row.current) openRow.close();
        openRow = row.current;
        haptic.tap();
      }}
      onSwipeableOpen={(direction) => {
        if (direction !== 'right' || !swipeRight) return;
        row.current?.close();
        swipeRight.onPress();
      }}
      onSwipeableClose={() => {
        if (openRow === row.current) openRow = null;
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
  action: { width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 },
});
