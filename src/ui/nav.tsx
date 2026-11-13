import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { type ReactNode } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoider } from './motion';
import { ToastHost } from './overlays';
import { IconButton, Screen } from './primitives';

/** Leave the current screen, falling back to Home when there is nowhere to go back to. */
export function closeScreen() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** A screen pushed on top of the tabs: a titled header with a close button, and room for a pinned footer. */
export function ModalScreen({
  title,
  children,
  footer,
  headerRight,
  testID,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  headerRight?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerBackVisible: false,
          headerLeft: () => <IconButton icon="close" label="Close" onPress={closeScreen} testID="close-screen" />,
          headerRight: headerRight ? () => headerRight : undefined,
        }}
      />
      <KeyboardAvoider style={styles.flex} bottomInset={insets.bottom}>
        <Screen edges={['bottom']} footer={footer} testID={testID}>
          {children}
        </Screen>
      </KeyboardAvoider>
      {/* On a phone this screen is a sheet that covers the app's own toast, so it shows one itself. */}
      {Platform.OS !== 'web' ? <ToastHost /> : null}
    </>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
