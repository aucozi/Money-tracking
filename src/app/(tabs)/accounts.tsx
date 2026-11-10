import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { currencyToBase } from '@/domain/context';
import { addMonthsToKey, formatMonth, monthKey, monthRange } from '@/domain/dates';
import { formatMoney, hasRate } from '@/domain/money';
import { netWorth, netWorthHistory } from '@/domain/networth';
import type { Account } from '@/domain/types';
import { ACCOUNT_TYPES, TabHeader } from '@/features/shared';
import { useBalances, useCtx, useData, useToday } from '@/store/hooks';
import { LineChart } from '@/ui/charts';
import { Button, Card, EmptyState, Glyph, IconButton, ListItem, Money, Notice, Pill, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export default function Accounts() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const balances = useBalances();
  const today = useToday();
  const base = data.settings.baseCurrency;
  const month = monthKey(today);

  const view = useMemo(() => {
    const months = monthRange(addMonthsToKey(month, -11), month);
    const history = netWorthHistory(data.accounts, data.transactions, ctx, months, today);
    return { worth: netWorth(data.accounts, balances, ctx), history };
  }, [data.accounts, data.transactions, ctx, balances, today, month]);

  const open = data.accounts.filter((account) => !account.archived);
  const archived = data.accounts.filter((account) => account.archived);
  const missingRates = [...new Set(open.map((account) => account.currency))].filter((code) => !hasRate(code, base, data.settings.rates));
  const first = view.history[0];
  const change = first && view.history.length > 1 ? view.worth.net - first.net : null;

  const row = (account: Account) => {
    const balance = balances.get(account.id) ?? 0;
    const foreign = account.currency !== base;
    return (
      <ListItem
        key={account.id}
        title={account.name}
        subtitle={foreign ? `About ${formatMoney(currencyToBase(balance, account.currency, ctx), base)}` : undefined}
        accessibilityLabel={`${account.name}, ${formatMoney(balance, account.currency)}`}
        leading={<Glyph icon={ACCOUNT_TYPES.find((item) => item.type === account.type)?.icon ?? '🗂️'} />}
        trailing={
          <View style={styles.right}>
            <Money amount={balance} currency={account.currency} weight="600" tone={balance < 0 ? 'negative' : 'text'} />
            {foreign && !hasRate(account.currency, base, data.settings.rates) ? <Pill label="Rate needed" tone="warning" /> : null}
          </View>
        }
        onPress={() => router.push({ pathname: '/account', params: { id: account.id } })}
        testID={`account-${account.id}`}
      />
    );
  };

  return (
    <Screen testID="accounts">
      <TabHeader title="Accounts">
        <IconButton icon="add" label="Add account" onPress={() => router.push('/account')} filled testID="add-account" />
      </TabHeader>

      {data.accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon="wallet-outline"
            title="No accounts yet"
            body="Add the accounts you want to keep an eye on: current accounts, savings, cards, loans, cash. Any currency works."
            action={<Button label="Add an account" icon="add" onPress={() => router.push('/account')} />}
          />
        </Card>
      ) : (
        <>
          <Card>
            <T variant="label" tone="muted">
              Net worth
            </T>
            <Money amount={view.worth.net} currency={base} variant="display" testID="accounts-net-worth" />
            <LineChart
              height={110}
              label={`Net worth over time, from ${formatMoney(first?.net ?? 0, base)} in ${first ? formatMonth(first.month) : 'the past'} to ${formatMoney(view.worth.net, base)} today.`}
              series={[{ values: view.history.map((point) => point.net), color: c.accent, fill: true }]}
            />
            <Row>
              <T variant="caption" tone="faint" style={styles.flex}>
                {first ? formatMonth(first.month, true) : ''}
              </T>
              <T variant="caption" tone="faint">
                Today
              </T>
            </Row>
            <Row>
              <View style={styles.flex}>
                <T variant="caption" tone="faint">
                  Owned
                </T>
                <Money amount={view.worth.assets} currency={base} variant="heading" />
              </View>
              <View style={styles.flex}>
                <T variant="caption" tone="faint">
                  Owed
                </T>
                <Money amount={view.worth.liabilities} currency={base} variant="heading" />
              </View>
              {change !== null && first ? (
                <View style={styles.flex}>
                  <T variant="caption" tone="faint">
                    Since {formatMonth(first.month, true)}
                  </T>
                  <Money amount={change} currency={base} variant="heading" tone={change >= 0 ? 'positive' : 'negative'} options={{ sign: 'always', whole: true }} />
                </View>
              ) : null}
            </Row>
          </Card>

          {missingRates.length > 0 ? (
            <Notice
              tone="warning"
              title={`Set an exchange rate for ${missingRates.join(', ')}`}
              body={`Until you do, those balances are counted one-for-one with ${base}, which makes totals wrong.`}
              action={<Button label="Open exchange rates" kind="ghost" small onPress={() => router.push('/settings')} />}
            />
          ) : null}

          {ACCOUNT_TYPES.map((group) => {
            const accounts = open.filter((account) => account.type === group.type);
            if (accounts.length === 0) return null;
            const total = accounts.reduce((sum, account) => sum + currencyToBase(balances.get(account.id) ?? 0, account.currency, ctx), 0);
            return (
              <View key={group.type} style={styles.group}>
                <SectionTitle
                  action={
                    <T variant="label" tone="muted" numeric>
                      {formatMoney(total, base)}
                    </T>
                  }>
                  {group.plural}
                </SectionTitle>
                <Card padded={false}>{accounts.map(row)}</Card>
              </View>
            );
          })}

          {archived.length > 0 ? (
            <View style={styles.group}>
              <SectionTitle>Closed</SectionTitle>
              <Card padded={false}>{archived.map(row)}</Card>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
  group: { gap: 12 },
});
