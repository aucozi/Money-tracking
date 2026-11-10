import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { Welcome } from '@/features/welcome';
import { flushSave, startAutosave, useStore } from '@/store/store';
import { FeedbackProvider } from '@/ui/overlays';
import { Button, Notice, Screen, Spacer, T } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function LoadProblem({ message }: { message: string }) {
  const startFresh = useStore((state) => state.startFresh);
  const restore = useStore((state) => state.restore);
  const data = useStore((state) => state.data);
  return (
    <Screen edges={['top', 'bottom']}>
      <Spacer />
      <T variant="title">Your saved data could not be opened</T>
      <Notice tone="negative" title="What went wrong" body={message} />
      <T tone="muted">
        Nothing has been deleted. The unreadable copy is kept on this device, and nothing will be saved over it until you
        choose to start again.
      </T>
      <Button
        label="Start again with empty data"
        kind="danger"
        onPress={() => {
          restore(data);
          startFresh(data.settings.baseCurrency);
        }}
      />
    </Screen>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const hydrated = useStore((state) => state.hydrated);
  const onboarded = useStore((state) => state.data.settings.onboarded);
  const loadError = useStore((state) => state.loadError);

  useEffect(() => {
    const stop = startAutosave();
    void useStore.getState().hydrate();
    // Write straight away when the app is put away, so nothing typed is lost.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushSave();
    });
    return () => {
      subscription.remove();
      stop();
    };
  }, []);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync().catch(() => undefined);
  }, [hydrated]);

  if (!hydrated) return null;

  const base = theme.dark ? DarkTheme : DefaultTheme;
  const navigation = {
    ...base,
    colors: { ...base.colors, background: theme.c.bg, card: theme.c.bg, text: theme.c.text, border: theme.c.border, primary: theme.c.accent },
  };
  const modal = { presentation: 'modal' as const };

  return (
    <ThemeProvider value={navigation}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <FeedbackProvider>
        {loadError ? (
          <LoadProblem message={loadError} />
        ) : !onboarded ? (
          <Welcome />
        ) : (
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: theme.c.bg },
              headerTintColor: theme.c.text,
              contentStyle: { backgroundColor: theme.c.bg },
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="transaction" options={modal} />
            <Stack.Screen name="account" options={modal} />
            <Stack.Screen name="recurring" options={modal} />
            <Stack.Screen name="goal" options={modal} />
            <Stack.Screen name="rule" options={modal} />
            <Stack.Screen name="category" options={modal} />
            <Stack.Screen name="import" options={modal} />
            <Stack.Screen name="rules" options={{ title: 'Rules' }} />
            <Stack.Screen name="categories" options={{ title: 'Categories' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
        )}
      </FeedbackProvider>
    </ThemeProvider>
  );
}
