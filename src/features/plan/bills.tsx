import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { currencyToBase } from '@/domain/context';
import { diffDays, formatDate, formatRelative } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { detectRecurring, FREQUENCY_LABEL, monthlyEquivalent, nextOccurrence, upcoming, type Occurrence } from '@/domain/recurring';
import { useCtx, useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Sheet, useToast } from '@/ui/overlays';
import { Button, Card, EmptyState, Glyph, ListItem, Money, Notice, Pill, Row, SectionTitle, T } from '@/ui/primitives';
import { space } from '@/ui/theme';

export function Bills() {
  const data = useData();
  const ctx = useCtx();
  const today = useToday();
  const toast = useToast();
  const store = useStore.getState();
  const [active, setActive] = useState<Occurrence | null>(null);
  const base = data.settings.baseCurrency;

  const view = useMemo(() => {
    const items = upcoming(data.recurrings, data.transactions, today, 45);
    const live = data.recurrings.filter((item) => item.status === 'active');
    const monthly = (sign: 1 | -1) =>
      live.filter((item) => Math.sign(item.amount) === sign).reduce((total, item) => total + currencyToBase(monthlyEquivalent(item), item.currency, ctx), 0);
    return {
      overdue: items.filter((item) => item.state === 'overdue'),
      soon: items.filter((item) => item.state !== 'overdue' && diffDays(today, item.date) <= 7),
      later: items.filter((item) => item.state !== 'overdue' && diffDays(today, item.date) > 7),
      suggestions: detectRecurring(data.transactions, data.recurrings, data.accounts, today).slice(0, 5),
      billsPerMonth: -monthly(-1),
      incomePerMonth: monthly(1),
    };
  }, [data.recurrings, data.transactions, data.accounts, ctx, today]);

  const section = (title: string, items: Occurrence[], overdue = false) =>
    items.length === 0 ? null : (
      <View style={styles.section}>
        <SectionTitle>{title}</SectionTitle>
        <Card padded={false}>
          {items.map((item) => (
            <ListItem
              key={`${item.recurring.id}-${item.date}`}
              title={item.recurring.name}
              subtitle={`${overdue ? 'Was due' : 'Due'} ${formatRelative(item.date, today).toLowerCase()} · ${formatDate(item.date)}`}
              leading={<Glyph icon={item.recurring.amount > 0 ? '💼' : overdue ? '⏰' : '🗓️'} />}
              trailing={
                <Money amount={item.recurring.amount} currency={item.recurring.currency} colored weight="600" tone={overdue ? 'negative' : undefined} />
              }
              onPress={() => setActive(item)}
              testID={`bill-${item.recurring.id}-${item.date}`}
            />
          ))}
        </Card>
      </View>
    );

  return (
    <>
      {data.recurrings.length > 0 ? (
        <Card>
          <Row>
            <View style={styles.flex}>
              <T variant="caption" tone="faint">
                Bills, per month
              </T>
              <Money amount={view.billsPerMonth} currency={base} variant="heading" testID="bills-per-month" />
            </View>
            <View style={styles.flex}>
              <T variant="caption" tone="faint">
                Regular income, per month
              </T>
              <Money amount={view.incomePerMonth} currency={base} variant="heading" tone="positive" />
            </View>
          </Row>
          <T variant="caption" tone="faint">
            Yearly and quarterly items are spread across the months they cover, so this is what to set aside each month.
          </T>
          <Button label="See what each one costs" kind="secondary" small onPress={() => router.push('/subscriptions')} testID="open-subscriptions" />
        </Card>
      ) : null}

      {view.suggestions.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle>Looks regular</SectionTitle>
          <Card padded={false}>
            {view.suggestions.map((suggestion) => (
              <ListItem
                key={suggestion.recurring.matchText + suggestion.recurring.amount}
                title={suggestion.recurring.name}
                subtitle={`${FREQUENCY_LABEL[suggestion.recurring.frequency]} · seen ${suggestion.seen} times · ${formatMoney(suggestion.recurring.amount, suggestion.recurring.currency)}`}
                leading={<Glyph icon="🔎" />}
                trailing={
                  <Button
                    label="Track"
                    kind="secondary"
                    small
                    onPress={() => {
                      const { id: _id, status: _status, skipped: _skipped, ...input } = suggestion.recurring;
                      store.addRecurring(input);
                      toast(`Tracking ${suggestion.recurring.name}`);
                    }}
                    testID={`track-${suggestion.recurring.name}`}
                  />
                }
              />
            ))}
          </Card>
          <T variant="caption" tone="faint">
            Found in your history. Nothing is tracked until you say so.
          </T>
        </View>
      ) : null}

      {section('Overdue', view.overdue, true)}
      {section('Next 7 days', view.soon)}
      {section('Later', view.later)}

      {data.recurrings.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title="No bills tracked yet"
            body="Add rent, subscriptions, your salary and anything else that repeats. Waypoint shows what is due and uses it to forecast your balance."
          />
        </Card>
      ) : view.overdue.length + view.soon.length + view.later.length === 0 ? (
        <Notice tone="positive" title="Nothing due in the next 45 days" />
      ) : null}

      <Button label="Add a bill or income" icon="add" onPress={() => router.push('/recurring')} testID="add-recurring" />

      {data.recurrings.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle>Everything you track</SectionTitle>
          <Card padded={false}>
            {[...data.recurrings]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((item) => {
                const next = item.status === 'active' ? nextOccurrence(item, today) : null;
                return (
                  <ListItem
                    key={item.id}
                    title={item.name}
                    subtitle={`${FREQUENCY_LABEL[item.frequency]}${next ? ` · next ${formatDate(next)}` : ''}`}
                    leading={<Glyph icon={item.amount > 0 ? '💼' : '🔁'} />}
                    trailing={
                      <View style={styles.right}>
                        <Money amount={item.amount} currency={item.currency} colored weight="600" />
                        {item.status !== 'active' ? <Pill label={item.status === 'paused' ? 'Paused' : 'Ended'} /> : null}
                      </View>
                    }
                    onPress={() => router.push({ pathname: '/recurring', params: { id: item.id } })}
                    testID={`recurring-${item.id}`}
                  />
                );
              })}
          </Card>
        </View>
      ) : null}

      <Sheet visible={active !== null} onClose={() => setActive(null)} title={active ? active.recurring.name : ''} testID="bill-sheet">
        {active ? (
          <>
            <T tone="muted">
              {formatMoney(active.recurring.amount, active.recurring.currency)} · due {formatDate(active.date, 'long')}
            </T>
            <Button
              label={active.recurring.amount > 0 ? 'Mark as received' : 'Mark as paid'}
              icon="checkmark"
              onPress={() => {
                const id = store.markPaid(active.recurring.id, active.date, today);
                toast(id ? 'Recorded' : 'Add an account first');
                setActive(null);
              }}
              testID="mark-paid"
            />
            <Button
              label="Skip this one"
              kind="secondary"
              onPress={() => {
                store.skipOccurrence(active.recurring.id, active.date);
                toast('Skipped');
                setActive(null);
              }}
              testID="skip-occurrence"
            />
            <Button
              label="Edit"
              kind="ghost"
              onPress={() => {
                const id = active.recurring.id;
                setActive(null);
                router.push({ pathname: '/recurring', params: { id } });
              }}
            />
            <T variant="caption" tone="faint">
              Marking it adds a transaction dated {formatDate(Math.abs(diffDays(active.date, today)) <= 12 ? today : active.date)}. If the payment arrives
              through an import instead, it is matched automatically.
            </T>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: space.md },
  right: { alignItems: 'flex-end', gap: 2 },
});
