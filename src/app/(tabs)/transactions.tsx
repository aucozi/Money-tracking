import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { transactionsToCSV } from '@/domain/backup';
import { formatDate, formatRelative, todayISO } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { filterTransactions, groupByDay, isFilterActive, sortNewestFirst, totalsOf, UNCATEGORIZED, type TxFilter } from '@/domain/transactions';
import type { Transaction } from '@/domain/types';
import { Fab, FloatingDock, TabHeader, TransactionRow, useLookups } from '@/features/shared';
import { saveTextFile } from '@/platform/files';
import { useCtx, useData, useToday, useUi } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Glass } from '@/ui/glass';
import { Sheet, useConfirm, useToast } from '@/ui/overlays';
import { AccountField, CategoryField, CategorySheet, DateField } from '@/ui/pickers';
import { Button, Chip, EmptyState, Field, IconButton, Row, T } from '@/ui/primitives';
import { closeOpenSwipe, SwipeRow, type SwipeAction } from '@/ui/swipe';
import { continuous, radius, space, useTheme, WEB_TAB_BAR_SPACE } from '@/ui/theme';
import { easeNextLayout } from '@/ui/motion';

type Quick = 'all' | 'review' | 'pending' | 'uncategorized' | 'expense' | 'income' | 'transfer';

function quickOf(filter: TxFilter): Quick {
  if (filter.needsReview) return 'review';
  if (filter.status === 'pending') return 'pending';
  if (filter.categoryIds?.length === 1 && filter.categoryIds[0] === UNCATEGORIZED) return 'uncategorized';
  return filter.type ?? 'all';
}

function withQuick(filter: TxFilter, quick: Quick): TxFilter {
  const next: TxFilter = {
    ...filter,
    needsReview: undefined,
    status: undefined,
    type: undefined,
  };
  if (quickOf(filter) === 'uncategorized') next.categoryIds = undefined;
  if (quick === 'review') next.needsReview = true;
  else if (quick === 'pending') next.status = 'pending';
  else if (quick === 'uncategorized') next.categoryIds = [UNCATEGORIZED];
  else if (quick !== 'all') next.type = quick;
  return next;
}

type ListRow = { kind: 'day'; date: string; total: number } | { kind: 'tx'; tx: Transaction; first: boolean; last: boolean };

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
  // The transactions a category is being chosen for: the selection, or one swiped row.
  const [categorizing, setCategorizing] = useState<string[] | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const chipScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const chipSpans = useRef(new Map<string, { x: number; width: number }>());
  const selecting = selected.size > 0;
  const base = data.settings.baseCurrency;

  const filtered = useMemo(
    () =>
      filterTransactions(data.transactions, filter, {
        categories: data.categories,
        accounts: data.accounts,
      }),
    [data.transactions, data.categories, data.accounts, filter],
  );
  const rows = useMemo<ListRow[]>(
    () =>
      groupByDay(filtered, ctx).flatMap((group) => [
        { kind: 'day' as const, date: group.date, total: group.total },
        ...group.items.map((tx, index) => ({ kind: 'tx' as const, tx, first: index === 0, last: index === group.items.length - 1 })),
      ]),
    [filtered, ctx],
  );
  const totals = useMemo(() => totalsOf(filtered, ctx), [filtered, ctx]);
  const reviewCount = useMemo(() => data.transactions.filter((tx) => !tx.reviewed).length, [data.transactions]);
  const quick = quickOf(filter);
  const extraFilters = [filter.accountIds?.length, quick !== 'uncategorized' && filter.categoryIds?.length, filter.from, filter.to, filter.tags?.length].filter(
    Boolean,
  ).length;

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

  // Keep the chosen quick filter on screen: the row scrolls sideways and the
  // filter can also be set from elsewhere, e.g. "to review" on Home.
  useEffect(() => {
    const span = chipSpans.current.get(quick);
    if (!span) return;
    const viewport = Math.min(windowWidth, 560);
    chipScroll.current?.scrollTo({ x: Math.max(0, span.x - (viewport - span.width) / 2), animated: true });
  }, [quick, windowWidth]);

  const remove = async (ids: string[]) => {
    const count = ids.length;
    const ok = await confirm({
      title: `Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}?`,
      message: 'This cannot be undone. Both sides of a transfer are deleted together.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    easeNextLayout();
    deleteTransactions(ids);
    clearSelection();
    toast(count === 1 ? 'Deleted' : `Deleted ${count}`);
  };

  const swipeActions = (tx: Transaction): { right: SwipeAction; trailing: SwipeAction[] } => ({
    right: tx.reviewed
      ? {
          label: 'To review',
          icon: 'ellipse-outline',
          color: c.surfaceAlt,
          onColor: c.text,
          onPress: () => updateTransactions([tx.id], { reviewed: false }),
        }
      : {
          label: 'Reviewed',
          icon: 'checkmark-circle',
          color: c.accent,
          onColor: c.onAccent,
          onPress: () => {
            if (quick === 'review') easeNextLayout();
            updateTransactions([tx.id], { reviewed: true });
          },
        },
    trailing: [
      ...(tx.kind === 'transfer' || tx.splits?.length
        ? []
        : [
            {
              label: 'Category',
              icon: 'pricetags-outline' as const,
              color: c.surfaceAlt,
              onColor: c.text,
              onPress: () => setCategorizing([tx.id]),
              testID: `swipe-categorize-${tx.id}`,
            },
          ]),
      { label: 'Delete', icon: 'trash-outline', color: c.negative, onColor: '#FFFFFF', onPress: () => void remove([tx.id]), testID: `swipe-delete-${tx.id}` },
    ],
  });

  const quickChips: { value: Quick; label: string }[] = [
    { value: 'all', label: 'All' },
    {
      value: 'review',
      label: reviewCount > 0 ? `To review · ${reviewCount}` : 'To review',
    },
    { value: 'pending', label: 'Pending' },
    { value: 'uncategorized', label: 'Uncategorized' },
    { value: 'expense', label: 'Expenses' },
    { value: 'income', label: 'Income' },
    { value: 'transfer', label: 'Transfers' },
  ];

  const header = (
    <View style={styles.header}>
      <TabHeader title="Transactions">
        <IconButton icon="download-outline" label="Import from CSV" onPress={() => router.push('/import')} testID="open-import" />
        <IconButton
          icon="share-outline"
          label="Export these transactions as CSV"
          onPress={exportFiltered}
          disabled={filtered.length === 0}
          testID="export-filtered"
        />
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
      <ScrollView
        ref={chipScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
        testID="quick-filters"
      >
        <Chip
          label={extraFilters > 0 ? `Filters · ${extraFilters}` : 'Filters'}
          icon="options-outline"
          selected={extraFilters > 0}
          onPress={() => setFiltersOpen(true)}
          testID="open-filters"
        />
        {quickChips.map((chip) => (
          <View key={chip.value} onLayout={(event) => chipSpans.current.set(chip.value, event.nativeEvent.layout)}>
            <Chip label={chip.label} selected={quick === chip.value} onPress={() => setFilter(withQuick(filter, chip.value))} testID={`quick-${chip.value}`} />
          </View>
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
              updateTransactions(
                filtered.map((tx) => tx.id),
                { reviewed: true },
              );
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
              body={
                data.accounts.length === 0
                  ? 'Add an account first, then record or import what you spend.'
                  : 'Add one with the + button, or import a CSV export from your bank.'
              }
              action={
                data.accounts.length === 0 ? (
                  <Button label="Add an account" onPress={() => router.push('/account')} />
                ) : (
                  <Button label="Import a CSV" kind="secondary" onPress={() => router.push('/import')} />
                )
              }
            />
          ) : (
            <EmptyState
              icon="search-outline"
              title="Nothing matches"
              body="Try a different search or clear the filters."
              action={<Button label="Clear filters" kind="secondary" onPress={() => setFilter({})} />}
            />
          )
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <Row style={styles.day}>
              <T variant="label" tone="muted" style={styles.flex}>
                {formatRelative(item.date, today) === formatDate(item.date)
                  ? formatDate(item.date, 'weekday')
                  : `${formatRelative(item.date, today)} · ${formatDate(item.date)}`}
              </T>
              <T variant="label" tone="faint" numeric>
                {formatMoney(item.total, base, { sign: 'always' })}
              </T>
            </Row>
          ) : (
            <View
              style={[
                styles.rowWrap,
                continuous,
                { backgroundColor: c.surface, borderBottomColor: c.border },
                item.first && styles.rowFirst,
                item.last && styles.rowLast,
              ]}
            >
              <SwipeRow enabled={!selecting} backgroundColor={c.surface} swipeRight={swipeActions(item.tx).right} trailing={swipeActions(item.tx).trailing}>
                <TransactionRow
                  tx={item.tx}
                  lookups={lookups}
                  selecting={selecting}
                  selected={selected.has(item.tx.id)}
                  onPress={() => {
                    closeOpenSwipe();
                    if (selecting) toggle(item.tx.id);
                    else router.push({ pathname: '/transaction', params: { id: item.tx.id } });
                  }}
                  onLongPress={() => {
                    closeOpenSwipe();
                    toggle(item.tx.id);
                  }}
                  onReview={
                    quick === 'review'
                      ? () => {
                          easeNextLayout();
                          updateTransactions([item.tx.id], { reviewed: true });
                        }
                      : undefined
                  }
                />
              </SwipeRow>
            </View>
          )
        }
      />

      {selecting ? (
        <FloatingDock align="stretch">
          <Glass style={styles.bulk} testID="bulk-bar">
            <IconButton icon="close" label="Cancel selection" onPress={clearSelection} />
            <T variant="label" style={styles.flex}>
              {selected.size} selected
            </T>
            <Button label="Categorize" kind="secondary" small onPress={() => setCategorizing([...selected])} testID="bulk-categorize" />
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
            <IconButton icon="trash-outline" label="Delete selected" tone="negative" onPress={() => void remove([...selected])} testID="bulk-delete" />
          </Glass>
        </FloatingDock>
      ) : (
        <Fab onPress={() => router.push('/transaction')} testID="fab-transactions" />
      )}

      <CategorySheet
        visible={categorizing !== null}
        title={categorizing && categorizing.length > 1 ? `Categorize ${categorizing.length}` : 'Category'}
        onClose={() => setCategorizing(null)}
        onPick={(id) => {
          if (categorizing) updateTransactions(categorizing, { categoryId: id, reviewed: true });
          setCategorizing(null);
          clearSelection();
          toast('Categorized');
        }}
      />

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={<Button label="Show results" onPress={() => setFiltersOpen(false)} testID="apply-filters" />}
      >
        <AccountField
          label="Account"
          allowNone="All accounts"
          value={filter.accountIds?.[0]}
          onChange={(id) => setFilter({ ...filter, accountIds: id ? [id] : undefined })}
        />
        <CategoryFilter
          value={quick === 'uncategorized' ? undefined : filter.categoryIds?.[0]}
          onChange={(id) =>
            setFilter({
              ...withQuick(filter, quick === 'uncategorized' ? 'all' : quick),
              categoryIds: id ? [id] : undefined,
            })
          }
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
          onChangeText={(tag) =>
            setFilter({
              ...filter,
              tags: tag.trim() ? [tag.trim().replace(/^#/, '')] : undefined,
            })
          }
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
  list: {
    paddingBottom: 140 + WEB_TAB_BAR_SPACE,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  header: {
    paddingHorizontal: space.lg,
    gap: space.md,
    paddingBottom: space.sm,
  },
  // The row runs to both screen edges, so chips slide out of view instead of being cut off at the margin.
  chipScroll: { marginHorizontal: -space.lg },
  chips: { gap: space.sm, paddingHorizontal: space.lg },
  day: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  // Each day is one rounded group: the first and last rows carry its corners.
  rowWrap: { marginHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  rowFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, borderBottomWidth: 0 },
  bulk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: 30,
    overflow: 'hidden',
  },
});
