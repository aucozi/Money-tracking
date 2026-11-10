import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Small physical confirmations, as iOS apps give. Silent where the device or
 * platform has no haptics, and never allowed to interrupt what triggered them.
 */
const run = (play: () => Promise<void>) => {
  if (Platform.OS === 'web') return;
  try {
    void play().catch(() => undefined);
  } catch {
    // No haptics engine: nothing to do.
  }
};

export const haptic = {
  /** Moving between options: tabs, segments, chips, toggles. */
  select: () => run(() => Haptics.selectionAsync()),
  /** Pressing a primary control. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Something was saved or completed. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** About to do something that cannot be undone. */
  warn: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
