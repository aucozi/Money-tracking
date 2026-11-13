import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { addMonthsToKey, formatDate, formatMonth, monthEnd, monthKey, monthStart } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { monthReview, type ReviewCategory } from '@/domain/review';
import { showTransactions, useLookups } from '@/features/shared';
import { useActivityIndex, useCtx, useData, useToday } from '@/store/hooks';
import { easeNextLayout } from '@/ui/motion';
import { Button, Card, EmptyState, Glyph, IconButton, ListItem, Money, ProgressBar, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { space } from '@/ui/theme';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function ReviewScreen() {
  const data = useData();
  const ctx = useCtx();
  const index = useActivityIndex();
  const lookups = useLookups();
  const today = useToday();
  const params = useLocalSearchParams<{ month?: string }>();
  const current = monthKey(today);
  const month = params.month && MONTH.test(params.month) && params.month <= current ? params.month : current;
  const base = data.settings.baseCurrency;
  const review = useMemo(() => monthReview(data, index, ctx, month, today), [data, index, ctx, month, today]);

  const money = (amount: number, whole = false) => formatMoney(amount, base, { whole });
  const before = formatMonth(addMonthsToKey(month, -1)).split(' ')[0];
  const go = (step: number) => {
    easeNextLayout();
    router.setParams({ month: addMonthsToKey(month, step) });
  };
  const empty = review.income === 0 && review.spent === 0 && review.transactions === 0;
  const largest = review.categories[0]?.spent ?? 0;

  const against = (row: ReviewCategory) => {
    const gap = row.spent - row.previous;
    if (row.previous === 0) return `Nothing in ${before}`;
    if (gap === 0) return `Same as ${before}`;
    return `${money(Math.abs(gap), true)} ${gap > 0 ? 'more' : 'less'} than ${before}`;
  };

  return (
    <Screen edges={['bottom']} testID="review-screen">
      <Stack.Screen options={{ title: 'Month in review' }} />
      <Row>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => go(-1)} testID="review-previous" />
        <T variant="heading" center style={styles.flex} testID="review-month">
          {formatMonth(month)}
        </T>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => go(1)} disabled={month >= current} testID="review-next" />
      </Row>

      {empty ? (
        <Card>
          <EmptyState icon="calendar-outline" title={`Nothing recorded in ${formatMonth(month)}`} body="Pick another month, or add what you spent." />
        </Card>
      ) : (
        <>
          <Card>
            <T variant="label" tone="muted">
              {review.kept >= 0
                ? review.complete
                  ? 'You kept'
                  : 'Kept so far'
                : review.complete
                  ? 'You spent more than came in by'
                  : 'Spent beyond income so far'}
            </T>
            <Money amount={Math.abs(review.kept)} currency={base} variant="display" tone={review.kept < 0 ? 'negative' : 'positive'} testID="review-kept" />
            {review.savingsRate !== null && review.kept > 0 ? <T tone="muted">That is {Math.round(review.savingsRate * 100)}% of what came in.</T> : null}
            <Row>
              <View style={styles.flex}>
                <T variant="caption" tone="faint">
                  Came in
                </T>
                <Money amount={review.income} currency={base} variant="heading" testID="review-income" />
              </View>
              <View style={styles.flex}>
                <T variant="caption" tone="faint">
                  Went out
                </T>
                <Money amount={review.spent} currency={base} variant="heading" testID="review-spent" />
              </View>
            </Row>
            <T variant="label" tone="muted" testID="review-compare">
              {review.spentChange.kind !== 'percent'
                ? `There is nothing from ${before} to compare with.`
                : Math.round(review.spentChange.value) === 0
                  ? `Spending was level with ${before} (${money(review.previous.spent, true)}).`
                  : `Spending was ${Math.abs(Math.round(review.spentChange.value))}% ${review.spentChange.value > 0 ? 'higher' : 'lower'} than in ${before} (${money(review.previous.spent, true)}).`}
              {review.movers[0]
                ? ` The biggest shift was ${review.movers[0].category.name}, ${review.movers[0].spent > review.movers[0].previous ? 'up' : 'down'} ${money(Math.abs(review.movers[0].spent - review.movers[0].previous), true)}.`
                : ''}
            </T>
          </Card>

          {review.categories.length > 0 ? (
            <>
              <SectionTitle>Where it went</SectionTitle>
              <Card>
                {review.categories.slice(0, 6).map((row) => (
                  <View key={row.category.id} style={styles.category}>
                    <Row>
                      <Glyph icon={row.category.icon} color={row.category.color} size={30} />
                      <View style={styles.flex}>
                        <T numberOfLines={1}>{row.category.name}</T>
                        <T variant="caption" tone="faint" numberOfLines={1}>
                          {against(row)}
                        </T>
                      </View>
                      <T numeric weight="600">
                        {money(row.spent)}
                      </T>
                    </Row>
                    <ProgressBar fraction={largest > 0 ? row.spent / largest : 0} color={row.category.color} height={6} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {review.budget ? (
            <>
              <SectionTitle>Against your budget</SectionTitle>
              <Card>
                <T variant="heading" testID="review-budget">
                  {review.budget.over.length === 0
                    ? 'Every budget held'
                    : `${review.budget.within} of ${review.budget.within + review.budget.over.length} budgets held`}
                </T>
                <T tone="muted">
                  {money(review.budget.spent, true)} spent of {money(review.budget.budgeted, true)} budgeted.
                </T>
                {review.budget.over.map((row) => (
                  <Row key={row.category.id}>
                    <Glyph icon={row.category.icon} color={row.category.color} size={30} />
                    <T style={styles.flex} numberOfLines={1}>
                      {row.category.name}
                    </T>
                    <T tone="negative" numeric weight="600">
                      over by {money(-row.available, true)}
                    </T>
                  </Row>
                ))}
              </Card>
            </>
          ) : null}

          {review.biggest.length > 0 ? (
            <>
              <SectionTitle>Biggest purchases</SectionTitle>
              <Card padded={false}>
                {review.biggest.map(({ tx, amount }) => {
                  const category = tx.categoryId ? lookups.category.get(tx.categoryId) : undefined;
                  return (
                    <ListItem
                      key={tx.id}
                      title={tx.payee}
                      subtitle={`${formatDate(tx.date)} · ${category?.name ?? (tx.splits?.length ? 'Split' : 'Uncategorized')}`}
                      leading={<Glyph icon={category?.icon ?? '?'} color={category?.color} />}
                      trailing={
                        <T numeric weight="600">
                          {money(amount)}
                        </T>
                      }
                      onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })}
                    />
                  );
                })}
              </Card>
            </>
          ) : null}

          {review.merchants.length > 0 ? (
            <>
              <SectionTitle>Where you went most</SectionTitle>
              <Card padded={false}>
                {review.merchants.map((item) => (
                  <ListItem
                    key={item.payee}
                    title={item.payee}
                    subtitle={`${item.count} times`}
                    trailing={
                      <T numeric weight="600">
                        {money(item.total)}
                      </T>
                    }
                    onPress={() => showTransactions({ query: item.payee, from: monthStart(month), to: monthEnd(month) })}
                  />
                ))}
              </Card>
            </>
          ) : null}

          <Card>
            <Row align="flex-start">
              <Stat value={String(review.transactions)} label={review.transactions === 1 ? 'purchase' : 'purchases'} />
              <Stat value={money(review.perDay, true)} label="a day on average" />
              <Stat value={String(review.quietDays)} label={review.quietDays === 1 ? 'day without spending' : 'days without spending'} />
            </Row>
          </Card>

          <Button
            label="See these transactions"
            kind="secondary"
            onPress={() => showTransactions({ from: monthStart(month), to: monthEnd(month) })}
            testID="review-transactions"
          />
          <T variant="caption" tone="faint" center>
            Transfers between your own accounts are left out. A purchase spread over several months counts by its share.
          </T>
        </>
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.flex}>
      <T variant="heading" numeric>
        {value}
      </T>
      <T variant="caption" tone="faint">
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  category: { gap: space.sm },
});
