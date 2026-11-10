import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatMoney } from '@/domain/money';
import type { TxFilter } from '@/domain/transactions';
import type { Account, AccountType, Category, Transaction } from '@/domain/types';
import { useData, useUi } from '@/store/hooks';
import { Glyph, IconButton, ListItem, Money, Pill, Row, T } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export const ACCOUNT_TYPES: { type: AccountType; label: string; plural: string; icon: string }[] = [
  { type: 'checking', label: 'Current account', plural: 'Current accounts', icon: '🏦' },
  { type: 'savings', label: 'Savings', plural: 'Savings', icon: '🐖' },
  { type: 'cash', label: 'Cash', plural: 'Cash', icon: '💵' },
  { type: 'investment', label: 'Investments', plural: 'Investments', icon: '📈' },
  { type: 'credit', label: 'Credit card', plural: 'Credit cards', icon: '💳' },
  { type: 'loan', label: 'Loan', plural: 'Loans', icon: '📄' },
  { type: 'other', label: 'Other', plural: 'Other', icon: '🗂️' },
];

/** Quick lookups by id for the things rows need to name. */
export function useLookups() {
  const data = useData();
  return useMemo(
    () => ({
      category: new Map<string, Category>(data.categories.map((category) => [category.id, category])),
      account: new Map<string, Account>(data.accounts.map((account) => [account.id, account])),
    }),
    [data.categories, data.accounts],
  );
}

/**
 * Open the Transactions tab showing exactly `filter`. Screens stacked above the
 * tabs are closed first, so this always returns to the one existing list
 * rather than opening a second copy of it.
 */
export function showTransactions(filter: TxFilter) {
  useUi.getState().setTxFilter(filter);
  if (router.canDismiss()) router.dismissTo('/transactions');
  else router.navigate('/transactions');
}

export function TransactionRow({
  tx,
  lookups,
  onPress,
  onLongPress,
  selected,
  selecting,
  onReview,
}: {
  tx: Transaction;
  lookups: ReturnType<typeof useLookups>;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  selecting?: boolean;
  /** When given, a one-tap "looks right" button is shown for unreviewed rows. */
  onReview?: () => void;
}) {
  const { c } = useTheme();
  const account = lookups.account.get(tx.accountId);
  const category = tx.categoryId ? lookups.category.get(tx.categoryId) : undefined;
  const currency = account?.currency ?? 'USD';
  const isTransfer = tx.kind === 'transfer';
  const isSplit = Boolean(tx.splits?.length);
  const what = isTransfer ? 'Transfer' : isSplit ? `Split in ${tx.splits!.length}` : (category?.name ?? 'Uncategorized');
  const subtitle = [what, account?.name].filter(Boolean).join(' · ');
  const label = `${tx.payee}, ${formatMoney(tx.amount, currency, { sign: 'always' })}, ${subtitle}${tx.status === 'pending' ? ', pending' : ''}${tx.reviewed ? '' : ', to review'}`;

  return (
    <ListItem
      title={tx.payee}
      subtitle={subtitle}
      accessibilityLabel={label}
      testID={`tx-${tx.id}`}
      selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      leading={
        selecting ? (
          <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={selected ? c.accent : c.textFaint} />
        ) : isTransfer ? (
          <Glyph icon="⇄" />
        ) : isSplit ? (
          <Glyph icon="🧾" />
        ) : (
          <Glyph icon={category?.icon ?? '❔'} color={category?.color} />
        )
      }
      trailing={
        <Row gap={6}>
          <View style={styles.amount}>
            <Money amount={tx.amount} currency={currency} colored={!isTransfer} tone={isTransfer ? 'muted' : undefined} variant="body" weight="600" />
            {tx.status === 'pending' ? <Pill label="Pending" tone="warning" /> : !tx.reviewed && !onReview ? <Pill label="To review" tone="accent" /> : null}
          </View>
          {onReview && !tx.reviewed && !selecting ? (
            <IconButton icon="checkmark-circle-outline" label={`Mark ${tx.payee} as reviewed`} tone="accent" size={26} onPress={onReview} />
          ) : null}
        </Row>
      }
    />
  );
}

/** The round add button that floats above the tab bar. */
export function Fab({ onPress, label = 'Add transaction', testID = 'fab' }: { onPress: () => void; label?: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.fab, { backgroundColor: c.accent, bottom: 16, opacity: pressed ? 0.85 : 1 }]}>
      <Ionicons name="add" size={30} color={c.onAccent} />
    </Pressable>
  );
}

/** Screen title with optional buttons on the right, used at the top of each tab. */
export function TabHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <Row style={styles.header}>
      <View style={styles.flex}>
        <T variant="title" accessibilityRole="header">
          {title}
        </T>
        {subtitle ? (
          <T variant="label" tone="muted">
            {subtitle}
          </T>
        ) : null}
      </View>
      {children}
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  amount: { alignItems: 'flex-end', gap: 2 },
  header: { paddingTop: 8, paddingBottom: 4, minHeight: 52 },
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
