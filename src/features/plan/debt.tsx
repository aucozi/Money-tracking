import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { addMonthsToKey, formatMonth, monthKey } from '@/domain/dates';
import { debtsFromAccounts, payoffPlan, type Strategy } from '@/domain/debt';
import { formatMoney } from '@/domain/money';
import { useBalances, useCtx, useData, useToday } from '@/store/hooks';
import { LineChart } from '@/ui/charts';
import { AmountField } from '@/ui/pickers';
import { Card, EmptyState, Glyph, ListItem, Money, Notice, Row, SectionTitle, Segmented, T } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export function DebtPlanner() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const balances = useBalances();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const [extra, setExtra] = useState<number | null>(0);
  const [strategy, setStrategy] = useState<Strategy>('avalanche');

  const debts = useMemo(() => debtsFromAccounts(data.accounts, balances, ctx), [data.accounts, balances, ctx]);
  const plan = useMemo(() => payoffPlan(debts, extra ?? 0, strategy), [debts, extra, strategy]);
  const other = useMemo(() => payoffPlan(debts, extra ?? 0, strategy === 'avalanche' ? 'snowball' : 'avalanche'), [debts, extra, strategy]);
  const withoutExtra = useMemo(() => payoffPlan(debts, 0, strategy), [debts, strategy]);
  const money = (amount: number) => formatMoney(amount, base, { whole: true });
  const monthOf = (months: number) => formatMonth(addMonthsToKey(monthKey(today), months));

  if (debts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="happy-outline"
          title="No debt to plan for"
          body="Credit cards and loans that carry a balance show up here, with a plan for clearing them."
        />
      </Card>
    );
  }

  const total = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const incomplete = debts.filter((debt) => debt.minPayment === 0 || debt.apr === 0);
  const saved = other.feasible && plan.feasible ? other.totalInterest - plan.totalInterest : 0;
  const extraSaves = withoutExtra.feasible && plan.feasible && (extra ?? 0) > 0;

  return (
    <>
      <Card>
        <T variant="label" tone="muted">
          Total owed
        </T>
        <Money amount={total} currency={base} variant="display" testID="debt-total" />
        <Segmented
          value={strategy}
          onChange={setStrategy}
          options={[
            { value: 'avalanche', label: 'Highest rate first' },
            { value: 'snowball', label: 'Smallest first' },
          ]}
          testID="debt-strategy"
        />
        <T variant="caption" tone="faint">
          {strategy === 'avalanche' ? 'Costs the least interest overall.' : 'Clears whole debts soonest, which some people find easier to stick with.'}
        </T>
        <AmountField label="Extra each month, on top of the minimums" value={extra} currency={base} onChange={setExtra} testID="debt-extra" />
      </Card>

      {plan.feasible ? (
        <Card>
          <Row>
            <View style={styles.flex}>
              <T variant="caption" tone="faint">
                Debt-free
              </T>
              <T variant="heading" testID="debt-free-date">
                {monthOf(plan.months)}
              </T>
              <T variant="caption" tone="faint">
                {plan.months} {plan.months === 1 ? 'month' : 'months'}
              </T>
            </View>
            <View style={styles.flex}>
              <T variant="caption" tone="faint">
                Interest you will pay
              </T>
              <Money amount={plan.totalInterest} currency={base} variant="heading" options={{ whole: true }} />
              <T variant="caption" tone="faint">
                paying {money(plan.monthlyPayment)} a month
              </T>
            </View>
          </Row>
          <LineChart
            height={110}
            zeroLine
            label={`Total owed falling from ${money(total)} to zero over ${plan.months} months.`}
            series={[{ values: plan.timeline, color: c.accent, fill: true }]}
          />
          {extraSaves ? (
            <T variant="label" tone="positive">
              The extra {money(extra ?? 0)} a month gets you there {withoutExtra.months - plan.months}{' '}
              {withoutExtra.months - plan.months === 1 ? 'month' : 'months'} sooner and saves {money(withoutExtra.totalInterest - plan.totalInterest)} in
              interest.
            </T>
          ) : null}
          {saved !== 0 ? (
            <T variant="label" tone="muted">
              {saved > 0
                ? `This order saves ${money(saved)} in interest compared with ${strategy === 'avalanche' ? 'smallest first' : 'highest rate first'}.`
                : `Highest rate first would save ${money(-saved)} more in interest.`}
            </T>
          ) : null}
        </Card>
      ) : (
        <Notice
          tone="negative"
          title="These payments never clear the debt"
          body="The monthly payments do not cover the interest being added. Enter the minimum payments on each account, or add an extra amount above."
        />
      )}

      {incomplete.length > 0 ? (
        <Notice
          tone="warning"
          title="Some details are missing"
          body={`${incomplete.map((debt) => debt.name).join(', ')}: add the interest rate and minimum payment on the account to make this plan accurate.`}
        />
      ) : null}

      <SectionTitle>{plan.feasible ? 'Order of attack' : 'Your debts'}</SectionTitle>
      <Card padded={false}>
        {(plan.feasible
          ? plan.order.map((step) => ({ step, debt: debts.find((debt) => debt.id === step.id)! }))
          : debts.map((debt) => ({ step: undefined, debt }))
        ).map(({ step, debt }, index) => (
          <ListItem
            key={debt.id}
            title={`${plan.feasible ? `${index + 1}. ` : ''}${debt.name}`}
            subtitle={`${debt.apr}% APR · ${money(debt.minPayment)} minimum${step ? ` · cleared ${monthOf(step.month)}` : ''}`}
            leading={<Glyph icon="💳" />}
            trailing={<Money amount={debt.balance} currency={base} weight="600" />}
            onPress={() => router.push({ pathname: '/account', params: { id: debt.id } })}
          />
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
