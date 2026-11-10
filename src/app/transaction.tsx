import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { newId } from '@/domain/context';
import { COMMON_CURRENCIES, formatMoney, parseAmount, toInputString } from '@/domain/money';
import { ruleFromCategorisation } from '@/domain/rules';
import { normalizePayee, parseTags, validateSplits } from '@/domain/transactions';
import type { Transaction } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AccountField, AmountField, CategoryField, DateField, FormActions, OptionField } from '@/ui/pickers';
import { Button, Card, Field, IconButton, Notice, Row, Segmented, T, ToggleRow } from '@/ui/primitives';
import { space } from '@/ui/theme';

type EntryType = 'expense' | 'income' | 'transfer';

interface PartDraft {
  id: string;
  amount: number | null;
  categoryId: string | null;
}

const SPREAD_OPTIONS = [1, 2, 3, 4, 6, 12].map((months) => ({
  value: String(months),
  label: months === 1 ? 'Just this month' : `Over ${months} months`,
  hint: months === 1 ? undefined : 'Counted evenly in each month, starting with this one',
}));

export default function TransactionScreen() {
  const params = useLocalSearchParams<{ id?: string; accountId?: string }>();
  const data = useData();
  const today = useToday();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.transactions.find((tx) => tx.id === params.id) : undefined;

  const openAccounts = data.accounts.filter((account) => !account.archived);
  const lastUsed = data.transactions.length > 0 ? data.transactions[data.transactions.length - 1].accountId : undefined;
  const defaultAccount =
    existing?.accountId ??
    (params.accountId && openAccounts.some((account) => account.id === params.accountId) ? params.accountId : undefined) ??
    (lastUsed && openAccounts.some((account) => account.id === lastUsed) ? lastUsed : undefined) ??
    openAccounts[0]?.id;

  const [type, setType] = useState<EntryType>(
    existing ? (existing.kind === 'transfer' ? 'transfer' : existing.amount > 0 ? 'income' : 'expense') : 'expense',
  );
  const [amount, setAmount] = useState<number | null>(existing ? Math.abs(existing.amount) : null);
  const [payee, setPayee] = useState(existing?.payee ?? '');
  const [accountId, setAccountId] = useState<string | undefined>(defaultAccount);
  const [toAccountId, setToAccountId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [date, setDate] = useState(existing?.date ?? today);
  const [pending, setPending] = useState(existing?.status === 'pending');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [parts, setParts] = useState<PartDraft[] | null>(
    existing?.splits?.length
      ? existing.splits.map((split) => ({ id: split.id, amount: Math.abs(split.amount), categoryId: split.categoryId }))
      : null,
  );
  const [spread, setSpread] = useState(String(existing?.spreadMonths ?? 1));
  const [originalText, setOriginalText] = useState(
    existing?.original ? toInputString(existing.original.amount, existing.original.currency) : '',
  );
  const [originalCurrency, setOriginalCurrency] = useState(existing?.original?.currency ?? '');
  const [recurringId, setRecurringId] = useState(existing?.recurringId);
  const [makeRule, setMakeRule] = useState(false);
  const [showMore, setShowMore] = useState(
    Boolean(existing && (existing.notes || existing.tags.length || existing.splits?.length || existing.spreadMonths || existing.original)),
  );
  const [attempted, setAttempted] = useState(false);

  const account = data.accounts.find((item) => item.id === accountId);
  const currency = account?.currency ?? data.settings.baseCurrency;
  const peer = existing?.transferPeerId ? data.transactions.find((tx) => tx.id === existing.transferPeerId) : undefined;
  const peerAccount = peer ? data.accounts.find((item) => item.id === peer.accountId) : undefined;
  const linkedBill = recurringId ? data.recurrings.find((item) => item.id === recurringId) : undefined;
  const category = data.categories.find((item) => item.id === categoryId);
  const isTransfer = type === 'transfer';
  // Money leaves the account unless it is income, or the receiving side of an existing transfer.
  const sign = type === 'income' || (isTransfer && existing?.kind === 'transfer' && existing.amount > 0) ? 1 : -1;

  const splitError =
    parts && amount !== null
      ? validateSplits({
          amount: sign * amount,
          splits: parts.map((part) => ({ id: part.id, amount: sign * (part.amount ?? 0), categoryId: part.categoryId })),
        })
      : null;
  const splitLeft = parts && amount !== null ? amount - parts.reduce((total, part) => total + (part.amount ?? 0), 0) : 0;

  const ruleExists = data.rules.some(
    (rule) => rule.conditions.payeeText && normalizePayee(rule.conditions.payeeText) === normalizePayee(payee),
  );
  const canMakeRule = !isTransfer && !parts && Boolean(category) && payee.trim().length > 1 && !ruleExists;

  const errors = {
    amount: amount === null || amount <= 0 ? 'Enter an amount greater than zero.' : null,
    account: !account ? 'Choose an account.' : null,
    transfer: isTransfer && toAccountId && toAccountId === accountId ? 'Choose two different accounts.' : null,
    split: splitError,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = () => {
    setAttempted(true);
    if (invalid || amount === null || !account) return;
    const original = parseAmount(originalText, originalCurrency || currency);
    const shared = {
      accountId: account.id,
      date,
      amount: sign * amount,
      payee: payee.trim() || (isTransfer ? 'Transfer' : 'Unnamed'),
      status: pending ? ('pending' as const) : ('cleared' as const),
      notes: notes.trim() || undefined,
      tags: parseTags(tags),
    };
    const standard: Partial<Transaction> = {
      kind: 'standard',
      categoryId: parts ? null : categoryId,
      splits: parts?.map((part) => ({ id: part.id, amount: sign * (part.amount ?? 0), categoryId: part.categoryId })),
      spreadMonths: Number(spread) > 1 ? Number(spread) : undefined,
      original: original && originalCurrency && originalCurrency !== currency ? { amount: Math.abs(original), currency: originalCurrency } : undefined,
      recurringId,
    };

    if (existing) {
      store.updateTransaction(existing.id, { ...shared, ...(isTransfer ? { kind: 'transfer' as const } : standard), reviewed: true });
    } else if (isTransfer && toAccountId) {
      store.addTransfer({
        fromAccountId: account.id,
        toAccountId,
        date,
        amount,
        payee: payee.trim() || undefined,
        notes: shared.notes,
        status: shared.status,
      });
    } else {
      store.addTransaction({ ...shared, ...(isTransfer ? { kind: 'transfer' as const } : standard), reviewed: true });
    }

    if (makeRule && canMakeRule && categoryId) {
      const { id: _unused, ...rule } = ruleFromCategorisation({ payee }, categoryId);
      const ruleId = store.addRule(rule);
      const changed = store.applyRuleToExisting(ruleId);
      toast(changed > 0 ? `Rule saved and applied to ${changed} more` : 'Rule saved');
    } else {
      toast(existing ? 'Saved' : 'Added');
    }
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: peer ? `The matching entry in ${peerAccount?.name ?? 'the other account'} is deleted too.` : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    store.deleteTransactions([existing.id]);
    toast('Deleted');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Transaction">
        <Notice tone="warning" title="This transaction no longer exists" body="It may have been deleted." />
      </ModalScreen>
    );
  }

  if (openAccounts.length === 0 && !existing) {
    return (
      <ModalScreen title="New transaction">
        <Notice tone="accent" title="Add an account first" body="Every transaction belongs to an account, such as your current account or a card." />
      </ModalScreen>
    );
  }

  const setPart = (id: string, patch: Partial<PartDraft>) =>
    setParts((current) => current?.map((part) => (part.id === id ? { ...part, ...patch } : part)) ?? null);

  return (
    <ModalScreen
      title={existing ? 'Edit transaction' : 'New transaction'}
      testID="transaction-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Add'} />}>
      <Segmented
        value={type}
        onChange={(next) => {
          setType(next);
          if (next === 'transfer') setParts(null);
          // An expense category makes no sense on income, and the other way round.
          if (next !== 'transfer' && category && category.kind !== next) setCategoryId(null);
        }}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
        testID="type-segmented"
      />

      <AmountField
        label="Amount"
        value={amount}
        currency={currency}
        onChange={setAmount}
        error={attempted ? errors.amount : null}
        autoFocus={!existing}
        testID="amount-input"
      />
      <Field
        label={isTransfer ? 'Description (optional)' : type === 'income' ? 'From' : 'Paid to'}
        value={payee}
        onChangeText={setPayee}
        placeholder={isTransfer ? 'e.g. Monthly savings' : type === 'income' ? 'e.g. Employer' : 'e.g. Corner bakery'}
        autoCapitalize="words"
        hint={existing?.rawPayee && existing.rawPayee !== payee ? `From your bank: ${existing.rawPayee}` : undefined}
        testID="payee-input"
      />
      <AccountField label={isTransfer ? 'From account' : 'Account'} value={accountId} onChange={setAccountId} />
      {attempted && errors.account ? (
        <T variant="caption" tone="negative">
          {errors.account}
        </T>
      ) : null}

      {isTransfer ? (
        existing ? (
          <Notice
            tone="accent"
            title={peerAccount ? `Linked to ${peerAccount.name}` : 'Counted as a transfer'}
            body={
              peerAccount
                ? 'The date and status stay in step with the other side. Transfers never count as spending or income.'
                : 'This is left out of spending and income. Switch the type above if it was really a purchase or a payment.'
            }
          />
        ) : (
          <>
            <AccountField
              label="To account"
              value={toAccountId}
              onChange={setToAccountId}
              exclude={accountId}
              allowNone="Somewhere outside Waypoint"
              testID="to-account-field"
            />
            {errors.transfer ? (
              <T variant="caption" tone="negative">
                {errors.transfer}
              </T>
            ) : null}
          </>
        )
      ) : parts ? null : (
        <CategoryField value={categoryId} onChange={setCategoryId} kind={type === 'income' ? 'income' : 'expense'} />
      )}

      <DateField value={date} onChange={(next) => next && setDate(next)} />
      <ToggleRow
        label="Pending"
        hint="Not cleared by the bank yet. It still counts in your balance."
        value={pending}
        onChange={setPending}
        testID="pending-toggle"
      />

      {canMakeRule ? (
        <ToggleRow
          label={`Always file "${payee.trim()}" under ${category?.name}`}
          hint="Creates a rule you can change or remove later, and applies it to matching transactions."
          value={makeRule}
          onChange={setMakeRule}
          testID="make-rule-toggle"
        />
      ) : null}

      {linkedBill ? (
        <Notice
          tone="positive"
          title={`Counts as a payment of ${linkedBill.name}`}
          action={<Button label="Unlink" kind="ghost" small onPress={() => setRecurringId(undefined)} />}
        />
      ) : null}

      {!showMore ? (
        <Button label="Notes, tags, split and more" kind="ghost" icon="chevron-down" onPress={() => setShowMore(true)} testID="show-more" />
      ) : (
        <Card>
          <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" multiline testID="notes-input" />
          <Field
            label="Tags"
            value={tags}
            onChangeText={setTags}
            placeholder="e.g. holiday, work"
            autoCapitalize="none"
            hint="Separate with commas. Search for #tag to find them later."
            testID="tags-input"
          />

          {!isTransfer ? (
            <>
              <ToggleRow
                label="Split between categories"
                hint="For one receipt that covers several things."
                value={parts !== null}
                onChange={(on) =>
                  setParts(
                    on
                      ? [
                          { id: newId('split_'), amount, categoryId },
                          { id: newId('split_'), amount: null, categoryId: null },
                        ]
                      : null,
                  )
                }
                testID="split-toggle"
              />
              {parts?.map((part, index) => (
                <View key={part.id} style={styles.part}>
                  <Row align="flex-start">
                    <View style={styles.flex}>
                      <AmountField
                        label={`Part ${index + 1}`}
                        value={part.amount}
                        currency={currency}
                        onChange={(value) => setPart(part.id, { amount: value })}
                        testID={`split-amount-${index}`}
                      />
                    </View>
                    <View style={styles.flex}>
                      <CategoryField
                        value={part.categoryId}
                        onChange={(id) => setPart(part.id, { categoryId: id })}
                        kind={type === 'income' ? 'income' : 'expense'}
                        testID={`split-category-${index}`}
                      />
                    </View>
                    {parts.length > 2 ? (
                      <View style={styles.remove}>
                        <IconButton icon="close-circle-outline" label={`Remove part ${index + 1}`} tone="faint" onPress={() => setParts(parts.filter((item) => item.id !== part.id))} />
                      </View>
                    ) : null}
                  </Row>
                </View>
              ))}
              {parts ? (
                <Row>
                  <T variant="label" tone={splitError ? 'warning' : 'positive'} style={styles.flex} testID="split-status">
                    {splitLeft === 0 && !splitError
                      ? 'The parts add up.'
                      : splitLeft > 0
                        ? `${formatMoney(splitLeft, currency)} still to assign.`
                        : splitLeft < 0
                          ? `${formatMoney(-splitLeft, currency)} too much.`
                          : (splitError ?? '')}
                  </T>
                  <Button label="Add part" kind="secondary" small onPress={() => setParts([...parts, { id: newId('split_'), amount: null, categoryId: null }])} />
                </Row>
              ) : null}

              <OptionField label="Count in the budget" options={SPREAD_OPTIONS} value={spread} onChange={setSpread} testID="spread-field" />

              <Row align="flex-start">
                <View style={styles.flex}>
                  <Field
                    label="Charged in another currency"
                    value={originalText}
                    onChangeText={setOriginalText}
                    placeholder="Original amount"
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                  />
                </View>
                <View style={styles.flex}>
                  <OptionField
                    label="Currency"
                    options={COMMON_CURRENCIES.filter((item) => item.code !== currency).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }))}
                    value={originalCurrency || undefined}
                    onChange={setOriginalCurrency}
                    placeholder="Choose"
                  />
                </View>
              </Row>
            </>
          ) : null}
        </Card>
      )}

      {attempted && invalid ? (
        <Notice tone="negative" title="A couple of things to fix" body={Object.values(errors).filter(Boolean).join(' ')} />
      ) : null}
    </ModalScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  part: { gap: space.sm },
  remove: { paddingTop: 26 },
});
