import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { useStore } from '@/store/store';
import { CurrencyField } from '@/ui/pickers';
import { Button, Card, Row, Screen, Spacer, T, type IconName } from '@/ui/primitives';
import { Icon } from '@/ui/icon';
import { continuous, space, useTheme } from '@/ui/theme';

function deviceCurrency(): string {
  try {
    const code = getLocales()[0]?.currencyCode;
    return code && /^[A-Z]{3}$/.test(code) ? code : 'USD';
  } catch {
    return 'USD';
  }
}

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'lock-closed-outline', title: 'Yours alone', body: 'Your data lives on this device. No account to create, and Waypoint never sees a bank password.' },
  {
    icon: 'globe-outline',
    title: 'Any bank, any currency',
    body: 'Add transactions by hand, import a CSV from any bank, or connect your bank for automatic updates.',
  },
  {
    icon: 'trending-up-outline',
    title: 'See what is coming',
    body: 'Bills, goals and a day-by-day forecast show where your balance is heading, not just where it has been.',
  },
];

export function Welcome() {
  const { c } = useTheme();
  const [currency, setCurrency] = useState(deviceCurrency);
  const startFresh = useStore((state) => state.startFresh);
  const loadDemo = useStore((state) => state.loadDemo);

  return (
    <Screen edges={['top', 'bottom']} testID="welcome">
      <Spacer size={space.xl} />
      <View style={[styles.mark, continuous, { backgroundColor: c.accent }]}>
        <Icon name="navigate" size={30} color={c.onAccent} />
      </View>
      <T variant="display">Waypoint</T>
      <T variant="heading" tone="muted" weight="400">
        Know where your money is, and where it is going.
      </T>
      <Spacer size={space.sm} />
      <Card>
        {POINTS.map((point) => (
          <Row key={point.title} align="flex-start">
            <View style={styles.pointIcon}>
              <Icon name={point.icon} size={22} color={c.accent} />
            </View>
            <View style={styles.flex}>
              <T variant="heading">{point.title}</T>
              <T tone="muted">{point.body}</T>
            </View>
          </Row>
        ))}
      </Card>
      <CurrencyField label="Your main currency" value={currency} onChange={setCurrency} />
      <T variant="caption" tone="faint">
        Totals are shown in this currency. You can still hold accounts in others.
      </T>
      <Spacer size={space.sm} />
      <Button label="Start fresh" onPress={() => startFresh(currency)} testID="start-fresh" />
      <Button label="Explore with sample data" kind="secondary" onPress={() => loadDemo(currency, todayISO())} testID="start-demo" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mark: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pointIcon: { marginTop: 2 },
});
