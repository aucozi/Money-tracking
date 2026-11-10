import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDate } from '@/domain/dates';
import { goalProgress } from '@/domain/goals';
import { formatMoney } from '@/domain/money';
import { useBalances, useCtx, useData, useToday } from '@/store/hooks';
import { Ring } from '@/ui/charts';
import { Button, Card, EmptyState, ListItem, Pill, T } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export function Goals() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const balances = useBalances();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const goals = useMemo(
    () =>
      data.goals
        .filter((goal) => !goal.archived)
        .map((goal) => ({ goal, progress: goalProgress(goal, data.accounts, balances, ctx, today) })),
    [data.goals, data.accounts, balances, ctx, today],
  );
  const money = (amount: number) => formatMoney(amount, base, { whole: true });

  return (
    <>
      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon="flag-outline"
            title="No goals yet"
            body="Name something worth saving for. Link it to a savings account to follow its balance, or add to it by hand."
          />
        </Card>
      ) : (
        <Card padded={false}>
          {goals.map(({ goal, progress }) => {
            const status =
              progress.state === 'done'
                ? 'Reached'
                : progress.monthlyNeeded !== null && goal.targetDate
                  ? `${money(progress.monthlyNeeded)} a month to reach it by ${formatDate(goal.targetDate, 'long')}`
                  : `${money(progress.remaining)} to go`;
            return (
              <ListItem
                key={goal.id}
                title={`${goal.icon} ${goal.name}`}
                subtitle={status}
                accessibilityLabel={`${goal.name}: ${money(progress.saved)} of ${money(progress.target)}. ${status}`}
                leading={
                  <View style={styles.ring}>
                    <Ring fraction={progress.fraction} color={progress.state === 'behind' ? c.warning : goal.color} size={48} stroke={5} />
                    <T variant="caption" numeric style={styles.percent}>
                      {Math.round(progress.fraction * 100)}%
                    </T>
                  </View>
                }
                trailing={
                  <View style={styles.right}>
                    <T numeric weight="600">
                      {money(progress.saved)}
                    </T>
                    <T numeric variant="caption" tone="faint">
                      of {money(progress.target)}
                    </T>
                    {progress.state === 'behind' ? <Pill label="Behind" tone="warning" /> : progress.state === 'on-track' ? <Pill label="On track" tone="positive" /> : progress.state === 'done' ? <Pill label="Done" tone="positive" /> : null}
                  </View>
                }
                onPress={() => router.push({ pathname: '/goal', params: { id: goal.id } })}
                testID={`goal-${goal.id}`}
              />
            );
          })}
        </Card>
      )}
      <Button label="Add a goal" icon="add" onPress={() => router.push('/goal')} testID="add-goal" />
    </>
  );
}

const styles = StyleSheet.create({
  ring: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  percent: { position: 'absolute' },
  right: { alignItems: 'flex-end', gap: 2 },
});
