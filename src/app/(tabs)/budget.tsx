import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { computeMonthBudget, suggestBudgets, type BudgetRow, type IncomeRow } from '@/domain/budget';
import { formatMonth, monthEnd, monthKey, monthStart } from '@/domain/dates';
import { currencyDecimals, formatMoney } from '@/domain/money';
import { UNCATEGORIZED } from '@/domain/transactions';
import type { Category } from '@/domain/types';
import { showTransactions, TabHeader } from '@/features/shared';
import { useActivityIndex, useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Sheet, useToast } from '@/ui/overlays';
import { AmountField, MonthSwitcher } from '@/ui/pickers';
import { Button, Card, Glyph, IconButton, ListItem, Money, Notice, Pill, ProgressBar, Row, Screen, SectionTitle, Segmented, T, ToggleRow } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export default function Budget() {
  const { c } = useTheme();
  const data = useData();
  const index = useActivityIndex();
  const today = useToday();
  const toast = useToast();
  const store = useStore.getState();
  const [month, setMonth] = useState(() => monthKey(today));
  const [editing, setEditing] = useState<Category | null>(null);
  const base = data.settings.baseCurrency;

  const budget = useMemo(() => computeMonthBudget(data, index, month), [data, index, month]);
  const suggestions = useMemo(
    () => suggestBudgets(data, index, month, 5 * 10 ** currencyDecimals(base)),
    [data, index, month, base],
  );
  const money = (amount: number, whole = false) => formatMoney(amount, base, { whole });
  const zero = budget.mode === 'zero';
  const left = budget.totalBudgeted - budget.totalSpent;
  const inMonth = { from: monthStart(month), to: monthEnd(month) };

  return (
    <Screen testID="budget">
      <TabHeader title="Budget">
        <IconButton icon="pricetags-outline" label="Manage categories" onPress={() => router.push('/categories')} filled testID="open-categories" />
      </TabHeader>
      <MonthSwitcher month={month} onChange={setMonth} />

      <Card>
        <Segmented
          value={budget.mode}
          onChange={(mode) => store.updateSettings({ budgetMode: mode })}
          options={[
            { value: 'tracking', label: 'Track spending' },
            { value: 'zero', label: 'Plan every ' + (base === 'USD' ? 'dollar' : base === 'EUR' ? 'euro' : base === 'GBP' ? 'pound' : 'unit') },
          ]}
          testID="budget-mode"
        />
        {zero ? (
          <>
            <Row>
              <Stat label={budget.incomeExpected > 0 ? 'Expected income' : 'Income so far'} value={money(budget.incomeForPlan, true)} />
              <Stat label="Assigned" value={money(budget.totalBudgeted, true)} />
            </Row>
            <View>
              <T variant="label" tone="muted">
                Left to assign
              </T>
              <Money
                amount={budget.leftToAssign}
                currency={base}
                variant="display"
                tone={budget.leftToAssign < 0 ? 'negative' : budget.leftToAssign === 0 ? 'positive' : 'text'}
                testID="left-to-assign"
              />
            </View>
            <T variant="label" tone="muted">
              {budget.leftToAssign > 0
                ? 'Give this money a job: add it to a category, a bill or a goal.'
                : budget.leftToAssign === 0
                  ? 'Every bit of income has a job this month.'
                  : 'You have planned to spend more than is coming in. Lower a budget or raise expected income.'}
            </T>
          </>
        ) : (
          <>
            <View>
              <T variant="label" tone="muted">
                Spent
              </T>
              <Row align="flex-end">
                <Money amount={budget.totalSpent} currency={base} variant="display" testID="budget-spent" />
                <T tone="muted" style={styles.baseline}>
                  of {money(budget.totalBudgeted, true)}
                </T>
              </Row>
            </View>
            <ProgressBar fraction={budget.totalBudgeted > 0 ? budget.totalSpent / budget.totalBudgeted : 0} color={left < 0 ? c.negative : c.accent} />
            <T variant="label" tone={left < 0 ? 'negative' : 'muted'}>
              {budget.totalBudgeted === 0
                ? 'No budgets yet. Tap a category below to set one.'
                : left >= 0
                  ? `${money(left)} left for ${formatMonth(month)}.`
                  : `${money(-left)} over budget for ${formatMonth(month)}.`}
            </T>
          </>
        )}
      </Card>

      {suggestions.length > 0 ? (
        <Notice
          tone="accent"
          title={`${suggestions.length} ${suggestions.length === 1 ? 'category has' : 'categories have'} spending but no budget`}
          body="Start from what you actually spent, averaged over recent months. You can change any of them afterwards."
          action={
            <Button
              label="Use my recent averages"
              kind="ghost"
              small
              onPress={() => {
                for (const suggestion of suggestions) store.setBudget(suggestion.categoryId, month, suggestion.amount, 'forward');
                toast(`Set ${suggestions.length} ${suggestions.length === 1 ? 'budget' : 'budgets'}`);
              }}
              testID="apply-suggestions"
            />
          }
        />
      ) : null}

      {budget.income.length > 0 ? (
        <>
          <SectionTitle>Income</SectionTitle>
          <Card padded={false}>
            {budget.income.map((row: IncomeRow) => (
              <ListItem
                key={row.category.id}
                title={row.category.name}
                subtitle={row.expected > 0 ? `${money(row.received)} of ${money(row.expected, true)} expected` : 'Tap to set what you expect'}
                leading={<Glyph icon={row.category.icon} color={row.category.color} />}
                trailing={<Money amount={row.received} currency={base} weight="600" tone={row.received > 0 ? 'positive' : 'faint'} />}
                onPress={() => setEditing(row.category)}
                testID={`budget-row-${row.category.id}`}
              />
            ))}
          </Card>
        </>
      ) : null}

      {budget.groups.map((group) =>
        group.rows.length === 0 ? null : (
          <View key={group.group.id} style={styles.group}>
            <SectionTitle
              action={
                <T variant="label" tone="muted" numeric>
                  {money(group.spent, true)}
                  {group.budgeted > 0 ? ` / ${money(group.budgeted, true)}` : ''}
                </T>
              }>
              {group.group.name}
            </SectionTitle>
            <Card padded={false}>
              {group.rows.map((row) => (
                <CategoryRow key={row.category.id} row={row} currency={base} onPress={() => setEditing(row.category)} />
              ))}
            </Card>
          </View>
        ),
      )}

      {budget.uncategorizedSpent > 0 ? (
        <Card padded={false}>
          <ListItem
            title="Uncategorized"
            subtitle="Give these a category so the budget is complete"
            leading={<Glyph icon="❔" />}
            trailing={<Money amount={budget.uncategorizedSpent} currency={base} weight="600" />}
            onPress={() => showTransactions({ ...inMonth, categoryIds: [UNCATEGORIZED] })}
            testID="budget-uncategorized"
          />
        </Card>
      ) : null}

      <BudgetSheet category={editing} month={month} onClose={() => setEditing(null)} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.flex}>
      <T variant="caption" tone="faint">
        {label}
      </T>
      <T variant="heading" numeric>
        {value}
      </T>
    </View>
  );
}

function CategoryRow({ row, currency, onPress }: { row: BudgetRow; currency: string; onPress: () => void }) {
  const { c } = useTheme();
  const money = (amount: number, whole = false) => formatMoney(amount, currency, { whole });
  const limit = row.budgeted + row.carryIn;
  const color = row.state === 'over' ? c.negative : row.state === 'near' ? c.warning : row.category.color;
  const status =
    row.state === 'unbudgeted'
      ? row.spent !== 0
        ? 'No budget set'
        : 'Tap to set a budget'
      : row.available >= 0
        ? `${money(row.available)} left`
        : `${money(-row.available)} over`;
  const label = `${row.category.name}: spent ${money(row.spent)}${row.state === 'unbudgeted' ? '' : ` of ${money(limit)}`}. ${status}.`;

  return (
    <ListItem
      title={row.category.name}
      accessibilityLabel={label}
      testID={`budget-row-${row.category.id}`}
      onPress={onPress}
      leading={<Glyph icon={row.category.icon} color={row.category.color} />}
      trailing={
        <View style={styles.rowRight}>
          <T numeric weight="600">
            {money(row.spent)}
            {row.state !== 'unbudgeted' ? (
              <T numeric tone="faint" variant="label">
                {' '}
                / {money(limit, true)}
              </T>
            ) : null}
          </T>
          {row.state !== 'unbudgeted' ? <View style={styles.bar}><ProgressBar fraction={row.spent / Math.max(1, limit)} color={color} height={5} /></View> : null}
          <Row gap={6}>
            {row.carryIn !== 0 ? <Pill label={`${row.carryIn > 0 ? '+' : '−'}${money(Math.abs(row.carryIn), true)} carried`} tone={row.carryIn > 0 ? 'positive' : 'negative'} /> : null}
            <T variant="caption" tone={row.state === 'over' ? 'negative' : row.state === 'near' ? 'warning' : 'faint'}>
              {status}
            </T>
          </Row>
        </View>
      }
    />
  );
}

function BudgetSheet({ category, month, onClose }: { category: Category | null; month: string; onClose: () => void }) {
  if (!category) return null;
  return <BudgetForm key={`${category.id}-${month}`} category={category} month={month} onClose={onClose} />;
}

function BudgetForm({ category, month, onClose }: { category: Category; month: string; onClose: () => void }) {
  const data = useData();
  const index = useActivityIndex();
  const store = useStore.getState();
  const toast = useToast();
  const base = data.settings.baseCurrency;
  const isIncome = category.kind === 'income';
  const row = computeMonthBudget(data, index, month)
    .groups.flatMap((group) => group.rows)
    .find((item) => item.category.id === category.id);
  const current = isIncome
    ? (computeMonthBudget(data, index, month).income.find((item) => item.category.id === category.id)?.expected ?? 0)
    : (row?.budgeted ?? 0);
  const [amount, setAmount] = useState<number | null>(current);
  const [scope, setScope] = useState<'forward' | 'month'>('forward');
  const [rollover, setRollover] = useState(category.rollover);

  const save = () => {
    store.setBudget(category.id, month, amount ?? 0, scope);
    if (!isIncome && rollover !== category.rollover) store.setRollover(category.id, rollover, month);
    toast('Budget saved');
    onClose();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`${category.icon} ${category.name}`}
      testID="budget-sheet"
      footer={<Button label="Save" onPress={save} testID="budget-save" />}>
      <AmountField
        label={isIncome ? `Expected in ${formatMonth(month)}` : `Budget for ${formatMonth(month)}`}
        value={amount}
        currency={base}
        onChange={setAmount}
        hint={row && !isIncome ? `Spent so far: ${formatMoney(row.spent, base)}` : undefined}
        testID="budget-amount"
      />
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'forward', label: 'From this month on' },
          { value: 'month', label: 'This month only' },
        ]}
        testID="budget-scope"
      />
      <T variant="caption" tone="faint">
        Earlier months always keep the budgets they had, so past results never change.
      </T>
      {!isIncome ? (
        <ToggleRow
          label="Carry the leftover forward"
          hint={
            category.rollover && category.rolloverFrom
              ? `On since ${formatMonth(category.rolloverFrom)}. Unspent money, or overspending, moves into the next month.`
              : 'Unspent money, or overspending, moves into the next month. Good for irregular costs like travel or gifts.'
          }
          value={rollover}
          onChange={setRollover}
          testID="rollover-toggle"
        />
      ) : null}
      <Button
        label="See these transactions"
        kind="ghost"
        onPress={() => {
          onClose();
          showTransactions({ from: monthStart(month), to: monthEnd(month), categoryIds: [category.id] });
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  baseline: { paddingBottom: 6 },
  group: { gap: space.md },
  rowRight: { alignItems: 'flex-end', gap: 4, maxWidth: 190 },
  bar: { width: 120 },
});
