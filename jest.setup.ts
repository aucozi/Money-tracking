// AsyncStorage has no native module under Jest; use the in-memory mock it ships.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// Swipe gestures run on the native animation runtime, which does not exist under Jest. Rows render
// without them here; the gesture itself is exercised in the browser tests.
jest.mock('@/ui/swipe', () => ({
  SwipeRow: ({ children }: { children: unknown }) => children,
  closeOpenSwipe: () => undefined,
}));
