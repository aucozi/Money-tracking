import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { computeMonthBudget, spendingByDay } from '@/domain/budget';
import { addDays, addMonthsToKey, formatDate, formatMonth, formatRelative, monthKey, monthRange, parts } from '@/domain/dates';
import { forecastBalance } from '@/domain/forecast';
import { cashflow, freeToSpend, pace, topCategories } from '@/domain/insights';
import { formatChange, formatMoney } from '@/domain/money';
import { netWorth, netWorthHistory } from '@/domain/networth';
import { scheduleBetween, upcoming } from '@/domain/recurring';
import { subscriptions } from '@/domain/subscriptions';
import { Fab, showTransactions, TabHeader } from '@/features/shared';
import { useActivityIndex, useBalances, useCtx, useData, useToday } from '@/store/hooks';
import { useBankRefresh } from '@/sync/run';
import { BarChart, LineChart } from '@/ui/charts';
import { useToast } from '@/ui/overlays';
import { Button, Card, EmptyState, Glyph, IconButton, ListItem, Money, Notice, ProgressBar, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export default function Home() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const index = useActivityIndex();
  const balances = useBalances();
  const today = useToday();
  const month = monthKey(today);
  const base = data.settings.baseCurrency;

  const view = useMemo(() => {
    const incomeIds = new Set(data.categories.filter((category) => category.kind === 'income').map((category) => category.id));
    const budget = computeMonthBudget(data, index, month);
    const thisMonth = spendingByDay(data.transactions, month, ctx, incomeIds);
    const lastMonth = spendingByDay(data.transactions, addMonthsToKey(month, -1), ctx, incomeIds);
    const schedule = scheduleBetween(data.recurrings, data.transactions, addDays(today, -35), addDays(today, 45), today);
    const months = monthRange(addMonthsToKey(month, -5), month);
    return {
      budget,
      thisMonth,
      lastMonth,
      pace: pace(thisMonth, lastMonth, budget.totalBudgeted, today, month),
      free: freeToSpend(budget, schedule, ctx, today),
      top: topCategories(budget, 4),
      upcoming: upcoming(data.recurrings, data.transactions, today, 14).slice(0, 5),
      worth: netWorth(data.accounts, balances, ctx),
      history: netWorthHistory(data.accounts, data.transactions, ctx, months, today),
      flow: cashflow(index, data.categories, months),
      forecast: forecastBalance({
        accounts: data.accounts,
        transactions: data.transactions,
        recurrings: data.recurrings,
        ctx,
        today,
        days: 30,
        everydaySpending: data.settings.forecastEverydaySpending,
      }),
      toReview: data.transactions.filter((tx) => !tx.reviewed).length,
      increases: subscriptions(data.recurrings, data.transactions, data.accounts, ctx, today).increases,
      lastMonthKept: cashflow(index, data.categories, [addMonthsToKey(month, -1)])[0],
    };
  }, [data, ctx, index, balances, today, month]);

  const toast = useToast();
  const refresh = useBankRefresh((result) =>
    toast(result.errors[0] ?? (result.added > 0 ? `${result.added} new ${result.added === 1 ? 'transaction' : 'transactions'}` : 'Already up to date')),
  );
  const money = (amount: number, whole = false) => formatMoney(amount, base, { whole });
  const day = parts(today).day;
  const hasAccounts = data.accounts.length > 0;
  const budgeted = view.budget.totalBudgeted;
  // The point a finger is resting on in each chart, if any: the figures above the chart follow it.
  const [spendDay, setSpendDay] = useState<number | null>(null);
  const [worthAt, setWorthAt] = useState<number | null>(null);
  const lastMonthBy = (index: number) => view.lastMonth[Math.min(index, view.lastMonth.length - 1)] ?? 0;
  const worthPoint = worthAt === null ? undefined : view.history[worthAt];

  return (
    <View style={styles.flex}>
      <Screen testID="home" {...refresh}>
        <TabHeader title={formatMonth(month)} subtitle="Your money at a glance">
          <IconButton icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} testID="open-settings" />
        </TabHeader>

        {!hasAccounts ? (
          <Card>
            <EmptyState
              icon="wallet-outline"
              title="Add your first account"
              body="Start with the account you use most. You can enter transactions by hand or import them from your bank's CSV export."
              action={<Button label="Add an account" icon="add" onPress={() => router.push('/account')} testID="add-first-account" />}
            />
          </Card>
        ) : (
          <>
            <Card>
              <T variant="label" tone="muted" testID="spent-label">
                {spendDay === null
                  ? 'Spent this month'
                  : spendDay < day
                    ? `Spent by ${formatDate(`${month}-${String(spendDay + 1).padStart(2, '0')}`)}`
                    : `Last month by day ${spendDay + 1}`}
              </T>
              <Row align="flex-end">
                <Money
                  amount={spendDay === null ? view.pace.spent : spendDay < day ? view.thisMonth[spendDay] : lastMonthBy(spendDay)}
                  currency={base}
                  variant="display"
                  testID="spent-this-month"
                />
                {spendDay !== null ? (
                  spendDay < day ? (
                    <T tone="muted" style={styles.baseline}>
                      last month {money(lastMonthBy(spendDay), true)}
                    </T>
                  ) : null
                ) : budgeted > 0 ? (
                  <T tone="muted" style={styles.baseline}>
                    of {money(budgeted, true)}
                  </T>
                ) : null}
              </Row>
              <LineChart
                label={`Spending so far this month is ${money(view.pace.spent)}. By the same day last month it was ${money(view.pace.lastMonthToDate)}.`}
                zeroLine
                series={[
                  ...(budgeted > 0
                    ? [{ values: view.thisMonth.map((_, i) => (budgeted * (i + 1)) / view.thisMonth.length), color: c.textFaint, dashed: true }]
                    : []),
                  { values: view.lastMonth, color: c.textFaint },
                  { values: view.thisMonth, color: c.accent, fill: true, upTo: day },
                ]}
                marker={{ index: day - 1, series: budgeted > 0 ? 2 : 1 }}
                onScrub={setSpendDay}
              />
              <Row style={styles.wrap} gap={space.lg}>
                <Legend color={c.accent} label="This month" />
                <Legend color={c.textFaint} label="Last month" />
                {budgeted > 0 ? <Legend color={c.textFaint} label="Even pace" dashed /> : null}
              </Row>
              <T variant="label" tone="muted">
                {view.pace.change.kind === 'percent'
                  ? `${formatChange(view.pace.change)} compared with the same day last month.`
                  : view.pace.change.kind === 'new'
                    ? 'Nothing was recorded by this day last month.'
                    : 'No spending recorded yet this month.'}
                {view.pace.expectedByNow !== null && view.pace.spent > view.pace.expectedByNow
                  ? ` You are ${money(view.pace.spent - view.pace.expectedByNow, true)} ahead of an even pace.`
                  : ''}
              </T>
            </Card>

            {view.free ? (
              <Card>
                <Row>
                  <View style={styles.flex}>
                    <T variant="label" tone="muted">
                      Free to spend
                    </T>
                    <Money amount={view.free.amount} currency={base} variant="title" tone={view.free.amount < 0 ? 'negative' : 'text'} />
                  </View>
                  {view.free.amount > 0 ? (
                    <View style={styles.right}>
                      <Money amount={view.free.perDay} currency={base} variant="heading" options={{ whole: true }} />
                      <T variant="caption" tone="faint">
                        a day for {view.free.daysLeft} {view.free.daysLeft === 1 ? 'day' : 'days'}
                      </T>
                    </View>
                  ) : null}
                </Row>
                <T variant="label" tone="muted">
                  {view.free.billsDue > 0
                    ? `Your budget, minus what you have spent and ${money(view.free.billsDue)} of bills still due this month.`
                    : 'Your budget, minus what you have spent. No more bills are due this month.'}
                </T>
              </Card>
            ) : null}

            {view.toReview > 0 ? (
              <Card padded={false}>
                <ListItem
                  title={`${view.toReview} ${view.toReview === 1 ? 'transaction' : 'transactions'} to review`}
                  subtitle="Check the category and tick them off"
                  leading={<Glyph icon="📥" />}
                  trailing={<IconButton icon="chevron-forward" label="Review" tone="faint" onPress={() => showTransactions({ needsReview: true })} />}
                  onPress={() => showTransactions({ needsReview: true })}
                  testID="review-card"
                />
              </Card>
            ) : null}

            {view.increases.map((item) => (
              <Notice
                key={item.recurring.id}
                tone="warning"
                title={`${item.recurring.name} went up`}
                body={`${formatMoney(item.change!.from, item.recurring.currency)} became ${formatMoney(item.change!.to, item.recurring.currency)}, which is ${formatMoney(item.change!.perYear, item.recurring.currency)} more over a year.`}
                action={<Button label="See subscriptions" kind="ghost" small onPress={() => router.push('/subscriptions')} testID="open-subscriptions-home" />}
              />
            ))}

            {day <= 10 && (view.lastMonthKept.income > 0 || view.lastMonthKept.spent > 0) ? (
              <Card padded={false}>
                <ListItem
                  title={`${formatMonth(view.lastMonthKept.month).split(' ')[0]} in review`}
                  subtitle={
                    view.lastMonthKept.net >= 0
                      ? `You kept ${money(view.lastMonthKept.net, true)}. See where the rest went.`
                      : `You spent ${money(-view.lastMonthKept.net, true)} more than came in. See where it went.`
                  }
                  leading={<Glyph icon="🗓️" />}
                  trailing={
                    <IconButton
                      icon="chevron-forward"
                      label="Open the review"
                      tone="faint"
                      onPress={() => router.push({ pathname: '/review', params: { month: view.lastMonthKept.month } })}
                    />
                  }
                  onPress={() => router.push({ pathname: '/review', params: { month: view.lastMonthKept.month } })}
                  testID="review-last-month"
                />
              </Card>
            ) : null}

            {view.forecast.firstNegative ? (
              <Notice
                tone="negative"
                title="Your cash is projected to run short"
                body={`On current plans your balance falls below zero ${formatRelative(view.forecast.firstNegative, today).toLowerCase()}, reaching ${money(view.forecast.low.balance)} at its lowest.`}
                action={<Button label="See the forecast" kind="ghost" small onPress={() => router.navigate('/plan')} />}
              />
            ) : null}

            {view.top.length > 0 ? (
              <>
                <SectionTitle action={<Button label="Budget" kind="ghost" small onPress={() => router.navigate('/budget')} />}>Where it went</SectionTitle>
                <Card>
                  {view.top.map((row) => (
                    <View key={row.category.id} style={styles.categoryRow}>
                      <Row>
                        <Glyph icon={row.category.icon} color={row.category.color} size={30} />
                        <T style={styles.flex} numberOfLines={1}>
                          {row.category.name}
                        </T>
                        <T numeric weight="600">
                          {money(row.spent)}
                        </T>
                        {row.budgeted + row.carryIn > 0 ? (
                          <T numeric tone="faint" variant="label">
                            / {money(row.budgeted + row.carryIn, true)}
                          </T>
                        ) : null}
                      </Row>
                      {row.state !== 'unbudgeted' ? (
                        <ProgressBar
                          fraction={row.spent / Math.max(1, row.budgeted + row.carryIn)}
                          color={row.state === 'over' ? c.negative : row.state === 'near' ? c.warning : row.category.color}
                          height={6}
                        />
                      ) : null}
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {view.upcoming.length > 0 ? (
              <>
                <SectionTitle action={<Button label="All bills" kind="ghost" small onPress={() => router.navigate('/plan')} />}>Coming up</SectionTitle>
                <Card padded={false}>
                  {view.upcoming.map((item) => (
                    <ListItem
                      key={`${item.recurring.id}-${item.date}`}
                      title={item.recurring.name}
                      subtitle={item.state === 'overdue' ? `Was due ${formatRelative(item.date, today).toLowerCase()}` : formatRelative(item.date, today)}
                      leading={<Glyph icon={item.recurring.amount > 0 ? '💼' : item.state === 'overdue' ? '⏰' : '🗓️'} />}
                      trailing={
                        <Money
                          amount={item.recurring.amount}
                          currency={item.recurring.currency}
                          colored
                          weight="600"
                          tone={item.state === 'overdue' ? 'negative' : undefined}
                        />
                      }
                    />
                  ))}
                </Card>
              </>
            ) : null}

            <SectionTitle action={<Button label="Accounts" kind="ghost" small onPress={() => router.navigate('/accounts')} />}>Net worth</SectionTitle>
            <Card>
              <T variant="caption" tone="faint">
                {worthPoint && worthPoint.month !== month ? `End of ${formatMonth(worthPoint.month)}` : 'Today'}
              </T>
              <Money amount={worthPoint ? worthPoint.net : view.worth.net} currency={base} variant="title" testID="net-worth" />
              <LineChart
                height={90}
                label={`Net worth over the last six months, now ${money(view.worth.net)}.`}
                series={[{ values: view.history.map((point) => point.net), color: c.accent, fill: true }]}
                onScrub={setWorthAt}
              />
              <Row>
                <View style={styles.flex}>
                  <T variant="caption" tone="faint">
                    Owned
                  </T>
                  <Money amount={view.worth.assets} currency={base} variant="label" />
                </View>
                <View style={styles.flex}>
                  <T variant="caption" tone="faint">
                    Owed
                  </T>
                  <Money amount={view.worth.liabilities} currency={base} variant="label" />
                </View>
              </Row>
            </Card>

            <SectionTitle action={<Button label="Month in review" kind="ghost" small onPress={() => router.push('/review')} testID="open-review" />}>
              Money in and out
            </SectionTitle>
            <Card>
              <BarChart
                label={`Income and spending for the last six months. This month: ${money(view.flow[view.flow.length - 1].income)} in, ${money(view.flow[view.flow.length - 1].spent)} out.`}
                groups={view.flow.map((item) => ({
                  label: item.month,
                  values: [
                    { value: item.income, color: c.positive },
                    { value: item.spent, color: c.accent },
                  ],
                }))}
              />
              <Row gap={0}>
                {view.flow.map((item) => (
                  <T key={item.month} variant="caption" tone="faint" center style={styles.flex}>
                    {formatMonth(item.month, true).slice(0, 3)}
                  </T>
                ))}
              </Row>
              <Row style={styles.wrap} gap={space.lg}>
                <Legend color={c.positive} label="In" />
                <Legend color={c.accent} label="Out" />
                <T variant="label" tone="muted" style={styles.flex} numberOfLines={1}>
                  Kept this month: {formatMoney(view.flow[view.flow.length - 1].net, base, { whole: true })}
                </T>
              </Row>
            </Card>
          </>
        )}
      </Screen>
      {hasAccounts ? <Fab onPress={() => router.push('/transaction')} testID="fab-home" /> : null}
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <Row gap={6}>
      <View
        style={[
          styles.swatch,
          { backgroundColor: dashed ? 'transparent' : color, borderColor: color, borderWidth: dashed ? 1 : 0, borderStyle: dashed ? 'dashed' : 'solid' },
        ]}
      />
      <T variant="caption" tone="muted">
        {label}
      </T>
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  baseline: { paddingBottom: 6 },
  wrap: { flexWrap: 'wrap' },
  right: { alignItems: 'flex-end' },
  categoryRow: { gap: 6 },
  swatch: { width: 14, height: 4, borderRadius: 2 },
});
