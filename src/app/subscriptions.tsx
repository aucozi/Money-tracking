import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDate } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { FREQUENCY_LABEL } from '@/domain/recurring';
import { subscriptions, type Subscription } from '@/domain/subscriptions';
import { useLookups } from '@/features/shared';
import { useCtx, useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { useToast } from '@/ui/overlays';
import { Button, Card, EmptyState, Glyph, ListItem, Money, Notice, ProgressBar, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export default function SubscriptionsScreen() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const today = useToday();
  const lookups = useLookups();
  const toast = useToast();
  const updateRecurring = useStore((state) => state.updateRecurring);
  const base = data.settings.baseCurrency;
  const view = useMemo(
    () => subscriptions(data.recurrings, data.transactions, data.accounts, ctx, today),
    [data.recurrings, data.transactions, data.accounts, ctx, today],
  );
  const changed = view.items.filter((item) => item.change);

  const subtitle = (item: Subscription) =>
    [FREQUENCY_LABEL[item.recurring.frequency], item.next ? `next ${formatDate(item.next)}` : '', item.payments === 0 ? 'no payment seen yet' : '']
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen edges={['bottom']} testID="subscriptions-screen">
      {view.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title="Nothing on a schedule yet"
            body="Track your rent, subscriptions and other regular payments, and this adds up what they cost you."
            action={<Button label="Add a bill" icon="add" onPress={() => router.push('/recurring')} />}
          />
        </Card>
      ) : (
        <>
          <Card>
            <Row align="flex-end">
              <View style={styles.flex}>
                <T variant="label" tone="muted">
                  Every month
                </T>
                <Money amount={view.monthly} currency={base} variant="display" testID="subscriptions-monthly" />
              </View>
              <View style={styles.right}>
                <T variant="caption" tone="faint">
                  Over a year
                </T>
                <Money amount={view.yearly} currency={base} variant="heading" options={{ whole: true }} testID="subscriptions-yearly" />
              </View>
            </Row>
            <T variant="caption" tone="faint">
              {view.items.length} regular {view.items.length === 1 ? 'payment' : 'payments'}. Yearly and quarterly ones are spread across the months they cover.
            </T>
          </Card>

          {changed.map((item) => {
            const change = item.change!;
            const up = change.to > change.from;
            const currency = item.recurring.currency;
            return (
              <Notice
                key={item.recurring.id}
                tone={up ? 'warning' : 'positive'}
                title={`${item.recurring.name} ${up ? 'went up' : 'got cheaper'}`}
                body={`${formatMoney(change.from, currency)} became ${formatMoney(change.to, currency)} on ${formatDate(change.date)}. That is ${formatMoney(Math.abs(change.perYear), currency)} ${up ? 'more' : 'less'} over a year.`}
                action={
                  <Button
                    label="Use the new price"
                    kind="ghost"
                    small
                    onPress={() => {
                      updateRecurring(item.recurring.id, { amount: -change.to });
                      toast(`${item.recurring.name} updated`);
                    }}
                    testID={`accept-price-${item.recurring.id}`}
                  />
                }
              />
            );
          })}

          <SectionTitle>Most expensive first</SectionTitle>
          <Card padded={false}>
            {view.items.map((item) => {
              const category = item.recurring.categoryId ? lookups.category.get(item.recurring.categoryId) : undefined;
              return (
                <View key={item.recurring.id}>
                  <ListItem
                    title={item.recurring.name}
                    subtitle={subtitle(item)}
                    leading={<Glyph icon={category?.icon ?? '🔁'} color={category?.color} />}
                    trailing={
                      <View style={styles.right}>
                        <Money amount={item.monthly} currency={base} weight="600" />
                        <T variant="caption" tone="faint">
                          a month
                        </T>
                      </View>
                    }
                    onPress={() => router.push({ pathname: '/recurring', params: { id: item.recurring.id } })}
                    testID={`subscription-${item.recurring.id}`}
                  />
                  <View style={styles.share}>
                    <ProgressBar fraction={view.monthly > 0 ? item.monthly / view.monthly : 0} color={category?.color ?? c.accent} height={4} />
                  </View>
                </View>
              );
            })}
          </Card>
          <T variant="caption" tone="faint">
            The bar shows each one&apos;s share of the total. These are the bills you track under Plan; add or pause them there.
          </T>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  right: { alignItems: 'flex-end' },
  share: { paddingHorizontal: space.lg, paddingBottom: space.md, marginTop: -space.xs },
});
