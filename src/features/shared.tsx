import { router } from 'expo-router';
import { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatMoney } from '@/domain/money';
import type { TxFilter } from '@/domain/transactions';
import type { Account, AccountType, Category, Transaction } from '@/domain/types';
import { useData, useUi } from '@/store/hooks';
import { Glyph, IconButton, ListItem, Money, Pill, Row, T } from '@/ui/primitives';
import { haptic } from '@/platform/haptics';
import { Glass } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { usePressScale } from '@/ui/motion';
import { space, useTheme, WEB_TAB_BAR_SPACE } from '@/ui/theme';

export const ACCOUNT_TYPES: {
  type: AccountType;
  label: string;
  plural: string;
  icon: string;
}[] = [
  {
    type: 'checking',
    label: 'Current account',
    plural: 'Current accounts',
    icon: '🏦',
  },
  { type: 'savings', label: 'Savings', plural: 'Savings', icon: '🐖' },
  { type: 'cash', label: 'Cash', plural: 'Cash', icon: '💵' },
  {
    type: 'investment',
    label: 'Investments',
    plural: 'Investments',
    icon: '📈',
  },
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
          <Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={selected ? c.accent : c.textFaint} />
        ) : isTransfer ? (
          <Glyph icon="⇄" />
        ) : isSplit ? (
          <Glyph icon="🧾" />
        ) : (
          <Glyph icon={category?.icon ?? '?'} color={category?.color} />
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

/**
 * Holds floating controls above the tab bar. On iPhone the tab bar is part of
 * the safe area, so a safe-area view keeps clear of it whatever its size; the
 * web build draws its own tab bar and leaves room for it explicitly.
 */
export function FloatingDock({ children, align = 'flex-end' }: { children: React.ReactNode; align?: 'flex-end' | 'stretch' }) {
  return (
    <SafeAreaView edges={['bottom']} pointerEvents="box-none" style={[styles.dock, { alignItems: align, paddingBottom: space.md + WEB_TAB_BAR_SPACE }]}>
      {children}
    </SafeAreaView>
  );
}

/** The add button: the one tinted glass control on the screen. */
export function Fab({ onPress, label = 'Add transaction', testID = 'fab' }: { onPress: () => void; label?: string; testID?: string }) {
  const { c } = useTheme();
  const press = usePressScale(0.9);
  return (
    <FloatingDock>
      <Animated.View style={press.style}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          onPress={() => {
            haptic.tap();
            onPress();
          }}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          testID={testID}
          style={styles.fabPress}
        >
          <Glass tint={c.accent} interactive style={styles.fab}>
            <Icon name="add" size={26} color={c.onAccent} />
          </Glass>
        </Pressable>
      </Animated.View>
    </FloatingDock>
  );
}

/**
 * The large title at the top of a tab. Buttons passed as children share one
 * glass capsule, the way toolbar items are grouped on iPhone.
 */
export function TabHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <Row style={styles.header} align="flex-start">
      <View style={styles.flex}>
        <T variant="title" accessibilityRole="header">
          {title}
        </T>
        {subtitle ? <T tone="muted">{subtitle}</T> : null}
      </View>
      {children ? <Glass style={styles.toolbar}>{children}</Glass> : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  amount: { alignItems: 'flex-end', gap: 2 },
  header: { paddingTop: space.sm, paddingBottom: space.xs, minHeight: 56 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingHorizontal: 2,
    height: 48,
    overflow: 'hidden',
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
  },
  fabPress: { borderRadius: 30 },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
