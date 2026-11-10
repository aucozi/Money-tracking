import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDate, formatRelative } from '@/domain/dates';
import { forecastBalance } from '@/domain/forecast';
import { formatMoney } from '@/domain/money';
import { isCashAccount } from '@/domain/types';
import { useCtx, useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { LineChart } from '@/ui/charts';
import { Card, EmptyState, Glyph, ListItem, Money, Notice, Row, SectionTitle, Segmented, T, ToggleRow } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export function ForecastView() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const today = useToday();
  const updateSettings = useStore((state) => state.updateSettings);
  const [days, setDays] = useState<'30' | '60' | '90'>('30');
  const base = data.settings.baseCurrency;
  const everyday = data.settings.forecastEverydaySpending;

  const forecast = useMemo(
    () =>
      forecastBalance({
        accounts: data.accounts,
        transactions: data.transactions,
        recurrings: data.recurrings,
        ctx,
        today,
        days: Number(days),
        everydaySpending: everyday,
      }),
    [data.accounts, data.transactions, data.recurrings, ctx, today, days, everyday],
  );
  const money = (amount: number) => formatMoney(amount, base);
  const cashAccounts = data.accounts.filter((account) => isCashAccount(account) && !account.archived);

  if (cashAccounts.length === 0) {
    return (
      <Card>
        <EmptyState icon="trending-up-outline" title="Nothing to forecast yet" body="Add a current, savings or cash account and the forecast will project its balance forward." />
      </Card>
    );
  }

  const lowIndex = forecast.points.findIndex((point) => point.date === forecast.low.date);
  const timeline = forecast.points
    .filter((point) => point.events.length > 0)
    .flatMap((point) => point.events.map((event) => ({ event, balance: point.balance })));

  return (
    <>
      <Segmented
        value={days}
        onChange={setDays}
        options={[
          { value: '30', label: '30 days' },
          { value: '60', label: '60 days' },
          { value: '90', label: '90 days' },
        ]}
        testID="forecast-days"
      />
      <Card>
        <Row>
          <View style={styles.flex}>
            <T variant="caption" tone="faint">
              Cash today
            </T>
            <Money amount={forecast.start} currency={base} variant="heading" testID="forecast-start" />
          </View>
          <View style={styles.flex}>
            <T variant="caption" tone="faint">
              In {days} days
            </T>
            <Money amount={forecast.end} currency={base} variant="heading" tone={forecast.end < 0 ? 'negative' : 'text'} testID="forecast-end" />
          </View>
        </Row>
        <LineChart
          height={150}
          zeroLine={forecast.low.balance < Math.abs(forecast.start) * 0.4}
          label={`Projected cash balance over ${days} days: from ${money(forecast.start)} today to ${money(forecast.end)}, lowest ${money(forecast.low.balance)} on ${formatDate(forecast.low.date, 'long')}.`}
          series={[{ values: forecast.points.map((point) => point.balance), color: forecast.firstNegative ? c.negative : c.accent, fill: true }]}
          marker={{ index: lowIndex, series: 0 }}
        />
        <Row>
          <T variant="caption" tone="faint" style={styles.flex}>
            Today
          </T>
          <T variant="caption" tone="faint">
            {formatDate(forecast.points[forecast.points.length - 1].date)}
          </T>
        </Row>
        <T variant="label" tone="muted">
          Lowest point: {money(forecast.low.balance)} {formatRelative(forecast.low.date, today).toLowerCase()}
          {formatRelative(forecast.low.date, today) === formatDate(forecast.low.date) ? '' : ` (${formatDate(forecast.low.date)})`}.
        </T>
      </Card>

      {forecast.firstNegative ? (
        <Notice
          tone="negative"
          title={`Runs short ${formatRelative(forecast.firstNegative, today).toLowerCase()}`}
          body="Move money in before then, delay a payment, or trim spending. The list below shows what is drawing the balance down."
        />
      ) : (
        <Notice tone="positive" title="You stay above zero the whole way" />
      )}

      <Card>
        <ToggleRow
          label="Include everyday spending"
          hint={
            forecast.everydayPerDay > 0
              ? `Assumes about ${money(forecast.everydayPerDay)} a day, your average over the last 90 days outside tracked bills.`
              : everyday
                ? 'Needs two weeks of history before it can estimate this. For now only tracked bills and income are counted.'
                : 'Off: only tracked bills and income are counted, which is the best case.'
          }
          value={everyday}
          onChange={(value) => updateSettings({ forecastEverydaySpending: value })}
          testID="forecast-everyday"
        />
        <T variant="caption" tone="faint">
          Covers {cashAccounts.map((account) => account.name).join(', ')}. Bills already overdue are assumed to be paid today; late income is not counted on.
        </T>
      </Card>

      {timeline.length > 0 ? (
        <>
          <SectionTitle>What moves it</SectionTitle>
          <Card padded={false}>
            {timeline.map(({ event, balance }, index) => (
              <ListItem
                key={`${event.recurringId}-${event.date}-${index}`}
                title={event.label}
                subtitle={`${event.overdue ? 'Overdue, assumed today' : formatDate(event.date, 'weekday')} · balance after ${money(balance)}`}
                leading={<Glyph icon={event.amount > 0 ? '💼' : event.overdue ? '⏰' : '🗓️'} />}
                trailing={<Money amount={event.amount} currency={base} colored weight="600" />}
              />
            ))}
          </Card>
        </>
      ) : (
        <T tone="muted" center style={styles.pad}>
          No tracked bills or income fall in this period. Add them under Bills to make the forecast useful.
        </T>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { paddingVertical: space.lg },
});
