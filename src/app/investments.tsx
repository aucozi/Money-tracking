import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDate } from '@/domain/dates';
import { formatFraction, portfolio, pricePerShare, type HoldingView } from '@/domain/investments';
import { formatMoney } from '@/domain/money';
import { CATEGORY_COLORS } from '@/domain/seed';
import { isSynced } from '@/store/ops';
import { useCtx, useData } from '@/store/hooks';
import { Button, Card, EmptyState, ListItem, Money, Notice, Pill, Row, Screen, SectionTitle, T } from '@/ui/primitives';
import { radius, space, useTheme } from '@/ui/theme';

const shares = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

export default function InvestmentsScreen() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const base = data.settings.baseCurrency;
  const all = useMemo(() => portfolio(data.holdings, ctx), [data.holdings, ctx]);
  const accounts = data.accounts.filter((account) => account.type === 'investment' && !account.archived);
  const colorOf = new Map(all.holdings.map((view, index) => [view.holding.id, CATEGORY_COLORS[index % CATEGORY_COLORS.length]]));
  const updated = data.holdings.reduce((latest, holding) => (holding.updatedAt > latest ? holding.updatedAt : latest), '');

  const row = (view: HoldingView, synced: boolean) => {
    const { holding } = view;
    const price = pricePerShare(holding);
    return (
      <ListItem
        key={holding.id}
        title={holding.symbol ? `${holding.symbol} · ${holding.name}` : holding.name}
        subtitle={`${shares(holding.shares)} ${holding.shares === 1 ? 'share' : 'shares'}${price !== null ? ` · ${formatMoney(price, holding.currency)} each` : ''}`}
        accessibilityLabel={`${holding.name}, worth ${formatMoney(view.value, base)}${view.gain !== null ? `, ${view.gain >= 0 ? 'up' : 'down'} ${formatMoney(Math.abs(view.gain), base)}` : ''}`}
        leading={
          <View style={styles.dotWell}>
            <View style={[styles.dot, { backgroundColor: colorOf.get(holding.id) ?? c.accent }]} />
          </View>
        }
        trailing={
          <View style={styles.right}>
            <Money amount={view.value} currency={base} weight="600" />
            {view.gain !== null && view.gainFraction !== null ? (
              <T variant="caption" numeric tone={view.gain >= 0 ? 'positive' : 'negative'}>
                {formatMoney(view.gain, base, { sign: 'always', whole: true })} · {formatFraction(view.gainFraction)}
              </T>
            ) : null}
          </View>
        }
        onPress={synced ? undefined : () => router.push({ pathname: '/holding', params: { id: holding.id } })}
        testID={`holding-${holding.id}`}
      />
    );
  };

  return (
    <Screen edges={['bottom']} testID="investments-screen">
      {all.holdings.length === 0 ? (
        <Card>
          <EmptyState
            icon="trending-up-outline"
            title="No holdings yet"
            body="Connect a brokerage and its positions appear here and update by themselves. Or add an investment account and enter what you hold by hand."
            action={<Button label="Connect a bank or brokerage" onPress={() => router.push('/connections')} />}
          />
        </Card>
      ) : (
        <Card>
          <T variant="label" tone="muted">
            Invested
          </T>
          <Money amount={all.value} currency={base} variant="display" testID="portfolio-value" />
          {all.gain !== null && all.gainFraction !== null ? (
            <T variant="heading" numeric tone={all.gain >= 0 ? 'positive' : 'negative'} testID="portfolio-gain">
              {formatMoney(all.gain, base, { sign: 'always' })} · {formatFraction(all.gainFraction)}
              <T variant="label" tone="muted">
                {'  '}since you bought{all.partialCost ? ', where the cost is known' : ''}
              </T>
            </T>
          ) : (
            <T variant="label" tone="muted">
              Add what you paid for a holding to see how it has done.
            </T>
          )}
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Allocation: ${all.holdings
              .slice(0, 5)
              .map((view) => `${view.holding.name} ${Math.round(view.weight * 100)} percent`)
              .join(', ')}`}
            style={[styles.allocation, { backgroundColor: c.surfaceAlt }]}
          >
            {all.holdings.map((view) => (
              <View key={view.holding.id} style={{ flex: Math.max(view.weight, 0.004), backgroundColor: colorOf.get(view.holding.id) }} />
            ))}
          </View>
          <Row style={styles.wrap} gap={space.md}>
            {all.holdings.slice(0, 6).map((view) => (
              <Row key={view.holding.id} gap={6}>
                <View style={[styles.swatch, { backgroundColor: colorOf.get(view.holding.id) }]} />
                <T variant="caption" tone="muted">
                  {view.holding.symbol ?? view.holding.name} {Math.round(view.weight * 100)}%
                </T>
              </Row>
            ))}
          </Row>
          {updated ? (
            <T variant="caption" tone="faint">
              Values as of {formatDate(updated, 'long')}.
            </T>
          ) : null}
        </Card>
      )}

      {accounts.map((account) => {
        const synced = isSynced(data, account.id);
        const own = all.holdings.filter((view) => view.holding.accountId === account.id);
        const value = own.reduce((total, view) => total + view.value, 0);
        return (
          <View key={account.id} style={styles.group}>
            <SectionTitle
              action={
                <Row gap={space.sm}>
                  {synced ? <Pill label="Synced" tone="positive" /> : null}
                  <T variant="label" tone="muted" numeric>
                    {formatMoney(value, base)}
                  </T>
                </Row>
              }
            >
              {account.name}
            </SectionTitle>
            {own.length > 0 ? <Card padded={false}>{own.map((view) => row(view, synced))}</Card> : null}
            {!synced ? (
              <Button
                label="Add a holding"
                kind="secondary"
                icon="add"
                onPress={() => router.push({ pathname: '/holding', params: { accountId: account.id } })}
                testID={`add-holding-${account.id}`}
              />
            ) : own.length === 0 ? (
              <T variant="label" tone="muted">
                The bank reports no individual holdings for this account, only its balance.
              </T>
            ) : null}
          </View>
        );
      })}

      {accounts.length === 0 && all.holdings.length === 0 ? null : (
        <Notice
          tone="accent"
          title="How values stay current"
          body="Holdings from a connected brokerage update each time it syncs, about once a day. Holdings you add by hand keep the value you enter until you change it."
        />
      )}
      {accounts.length === 0 ? <Button label="Add an investment account" kind="secondary" icon="add" onPress={() => router.push('/account')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  right: { alignItems: 'flex-end', gap: 2 },
  dotWell: { width: 40, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  allocation: { flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  wrap: { flexWrap: 'wrap' },
  group: { gap: space.md },
});
