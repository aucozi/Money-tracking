import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { transactionsToCSV } from '@/domain/backup';
import { formatDate, formatRelative, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import {
  filterTransactions,
  groupByDay,
  isFilterActive,
  sortNewestFirst,
  totalsOf,
  UNCATEGORIZED,
  type TxFilter,
} from '@/domain/transactions';
import type { Transaction } from '@/domain/types';
import { Fab, TabHeader, TransactionRow, useLookups } from '@/features/shared';
import { saveTextFile } from '@/platform/files';
import { useCtx, useData, useToday, useUi } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Sheet, useConfirm, useToast } from '@/ui/overlays';
import { AccountField, CategoryField, CategorySheet, DateField } from '@/ui/pickers';
import { Button, Chip, EmptyState, Field, IconButton, Row, T } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

type Quick = 'all' | 'review' | 'pending' | 'uncategorized' | 'expense' | 'income' | 'transfer';

function quickOf(filter: TxFilter): Quick {
  if (filter.needsReview) return 'review';
  if (filter.status === 'pending') return 'pending';
  if (filter.categoryIds?.length === 1 && filter.categoryIds[0] === UNCATEGORIZED) return 'uncategorized';
  return filter.type ?? 'all';
}

function withQuick(filter: TxFilter, quick: Quick): TxFilter {
  const next: TxFilter = { ...filter, needsReview: undefined, status: undefined, type: undefined };
  if (quickOf(filter) === 'uncategorized') next.categoryIds = undefined;
  if (quick === 'review') next.needsReview = true;
  else if (quick === 'pending') next.status = 'pending';
  else if (quick === 'uncategorized') next.categoryIds = [UNCATEGORIZED];
  else if (quick !== 'all') next.type = quick;
  return next;
}

type ListRow = { kind: 'day'; date: string; total: number } | { kind: 'tx'; tx: Transaction };

export default function Transactions() {
  const { c } = useTheme();
  const data = useData();
  const ctx = useCtx();
  const lookups = useLookups();
  const today = useToday();
  const filter = useUi((state) => state.txFilter);
  const setFilter = useUi((state) => state.setTxFilter);
  const updateTransactions = useStore((state) => state.updateTransactions);
  const deleteTransactions = useStore((state) => state.deleteTransactions);
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const selecting = selected.size > 0;
  const base = data.settings.baseCurrency;

  const filtered = useMemo(
    () => filterTransactions(data.transactions, filter, { categories: data.categories, accounts: data.accounts }),
    [data.transactions, data.categories, data.accounts, filter],
  );
  const rows = useMemo<ListRow[]>(
    () =>
      groupByDay(filtered, ctx).flatMap((group) => [
        { kind: 'day' as const, date: group.date, total: group.total },
        ...group.items.map((tx) => ({ kind: 'tx' as const, tx })),
      ]),
    [filtered, ctx],
  );
  const totals = useMemo(() => totalsOf(filtered, ctx), [filtered, ctx]);
  const reviewCount = useMemo(() => data.transactions.filter((tx) => !tx.reviewed).length, [data.transactions]);
  const quick = quickOf(filter);
  const extraFilters = [filter.accountIds?.length, quick !== 'uncategorized' && filter.categoryIds?.length, filter.from, filter.to, filter.tags?.length].filter(Boolean).length;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const clearSelection = () => setSelected(new Set());

  const exportFiltered = async () => {
    try {
      await saveTextFile(`waypoint-transactions-${todayISO()}.csv`, transactionsToCSV(sortNewestFirst(filtered), data), 'text/csv');
      toast(`Exported ${filtered.length} ${filtered.length === 1 ? 'transaction' : 'transactions'}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not export');
    }
  };

  const removeSelected = async () => {
    const count = selected.size;
    const ok = await confirm({
      title: `Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}?`,
      message: 'This cannot be undone. Both sides of a transfer are deleted together.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteTransactions([...selected]);
    clearSelection();
    toast(`Deleted ${count}`);
  };

  const quickChips: { value: Quick; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'review', label: reviewCount > 0 ? `To review · ${reviewCount}` : 'To review' },
    { value: 'pending', label: 'Pending' },
    { value: 'uncategorized', label: 'Uncategorized' },
    { value: 'expense', label: 'Expenses' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfers' },
  ];

  const header = (
    <View style={styles.header}>
      <TabHeader title="Transactions">
        <IconButton icon="download-outline" label="Import from CSV" onPress={() => router.push('/import')} filled testID="open-import" />
        <IconButton icon="share-outline" label="Export these transactions as CSV" onPress={exportFiltered} filled disabled={filtered.length === 0} testID="export-filtered" />
      </TabHeader>
      <Row>
        <View style={styles.flex}>
          <Field
            label="Search"
            placeholder="Payee, note, #tag, amount…"
            value={filter.query ?? ''}
            onChangeText={(query) => setFilter({ ...filter, query })}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            testID="tx-search"
          />
        </View>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip
          label={extraFilters > 0 ? `Filters · ${extraFilters}` : 'Filters'}
          icon="options-outline"
          selected={extraFilters > 0}
          onPress={() => setFiltersOpen(true)}
          testID="open-filters"
        />
        {quickChips.map((chip) => (
          <Chip key={chip.value} label={chip.label} selected={quick === chip.value} onPress={() => setFilter(withQuick(filter, chip.value))} testID={`quick-${chip.value}`} />
        ))}
      </ScrollView>
      <Row>
        <T variant="label" tone="muted" style={styles.flex} testID="tx-summary">
          {totals.count} {totals.count === 1 ? 'transaction' : 'transactions'}
          {totals.spent > 0 ? ` · ${formatMoney(totals.spent, base)} out` : ''}
          {totals.income > 0 ? ` · ${formatMoney(totals.income, base)} in` : ''}
        </T>
        {quick === 'review' && filtered.length > 0 ? (
          <Button
            label="Mark all reviewed"
            kind="ghost"
            small
            onPress={() => {
              updateTransactions(filtered.map((tx) => tx.id), { reviewed: true });
              toast('All caught up');
            }}
            testID="review-all"
          />
        ) : isFilterActive(filter) ? (
          <Button label="Clear" kind="ghost" small onPress={() => setFilter({})} testID="clear-filter" />
        ) : null}
      </Row>
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={[styles.flex, { backgroundColor: c.bg }]} testID="transactions">
      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(row) => (row.kind === 'day' ? `day-${row.date}` : row.tx.id)}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={24}
        ListEmptyComponent={
          data.transactions.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              title="No transactions yet"
              body={data.accounts.length === 0 ? 'Add an account first, then record or import what you spend.' : 'Add one with the + button, or import a CSV export from your bank.'}
              action={
                data.accounts.length === 0 ? (
                  <Button label="Add an account" onPress={() => router.push('/account')} />
                ) : (
                  <Button label="Import a CSV" kind="secondary" onPress={() => router.push('/import')} />
                )
              }
            />
          ) : (
            <EmptyState icon="search-outline" title="Nothing matches" body="Try a different search or clear the filters." action={<Button label="Clear filters" kind="secondary" onPress={() => setFilter({})} />} />
          )
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Row style={styles.day}>
              <T variant="label" tone="muted" style={styles.flex}>
                {formatRelative(item.date, today) === formatDate(item.date) ? formatDate(item.date, 'weekday') : `${formatRelative(item.date, today)} · ${formatDate(item.date)}`}
              </T>
              <T variant="label" tone="faint" numeric>
                {formatMoney(item.total, base, { sign: 'always' })}
              </T>
            </Row>
          ) : (
            <View style={[styles.rowWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
              <TransactionRow
                tx={item.tx}
                lookups={lookups}
                selecting={selecting}
                selected={selected.has(item.tx.id)}
                onPress={() => (selecting ? toggle(item.tx.id) : router.push({ pathname: '/transaction', params: { id: item.tx.id } }))}
                onLongPress={() => toggle(item.tx.id)}
                onReview={quick === 'review' ? () => updateTransactions([item.tx.id], { reviewed: true }) : undefined}
              />
            </View>
          )
        }
      />

      {selecting ? (
        <View style={[styles.bulk, { backgroundColor: c.surface, borderColor: c.border }]} testID="bulk-bar">
          <IconButton icon="close" label="Cancel selection" onPress={clearSelection} />
          <T variant="label" style={styles.flex}>
            {selected.size} selected
          </T>
          <Button label="Categorize" kind="secondary" small onPress={() => setCategorizing(true)} testID="bulk-categorize" />
          <Button
            label="Reviewed"
            kind="secondary"
            small
            onPress={() => {
              updateTransactions([...selected], { reviewed: true });
              clearSelection();
            }}
            testID="bulk-review"
          />
          <IconButton icon="trash-outline" label="Delete selected" tone="negative" onPress={removeSelected} testID="bulk-delete" />
        </View>
      ) : (
        <Fab onPress={() => router.push('/transaction')} />
      )}

      <CategorySheet
        visible={categorizing}
        title={`Categorize ${selected.size}`}
        onClose={() => setCategorizing(false)}
        onPick={(id) => {
          updateTransactions([...selected], { categoryId: id, reviewed: true });
          setCategorizing(false);
          clearSelection();
          toast('Categorized');
        }}
      />

      <Sheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" footer={<Button label="Show results" onPress={() => setFiltersOpen(false)} testID="apply-filters" />}>
        <AccountField
          label="Account"
          allowNone="All accounts"
          value={filter.accountIds?.[0]}
          onChange={(id) => setFilter({ ...filter, accountIds: id ? [id] : undefined })}
        />
        <CategoryFilter
          value={quick === 'uncategorized' ? undefined : filter.categoryIds?.[0]}
          onChange={(id) => setFilter({ ...withQuick(filter, quick === 'uncategorized' ? 'all' : quick), categoryIds: id ? [id] : undefined })}
        />
        <Row align="flex-start">
          <View style={styles.flex}>
            <DateField label="From" value={filter.from} onChange={(from) => setFilter({ ...filter, from })} clearable placeholder="Any" />
          </View>
          <View style={styles.flex}>
            <DateField label="To" value={filter.to} onChange={(to) => setFilter({ ...filter, to })} clearable placeholder="Any" />
          </View>
        </Row>
        <Field
          label="Tag"
          placeholder="e.g. lisbon-trip"
          autoCapitalize="none"
          value={filter.tags?.[0] ?? ''}
          onChangeText={(tag) => setFilter({ ...filter, tags: tag.trim() ? [tag.trim().replace(/^#/, '')] : undefined })}
        />
        <Button label="Clear all filters" kind="ghost" onPress={() => setFilter({})} />
      </Sheet>
    </SafeAreaView>
  );
}

function CategoryFilter({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  return (
    <View>
      <CategoryField label="Category" value={value ?? null} onChange={(id) => onChange(id ?? undefined)} />
      {value ? <Button label="Any category" kind="ghost" small onPress={() => onChange(undefined)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: 140, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.sm },
  chips: { gap: space.sm, paddingRight: space.lg },
  day: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  rowWrap: { marginHorizontal: space.lg, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  bulk: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
