import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { formatMoney } from '@/domain/money';
import { FREQUENCY_LABEL, monthlyEquivalent } from '@/domain/recurring';
import type { Frequency, RecurringStatus } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AccountField, AmountField, CategoryField, CurrencyField, DateField, FormActions, OptionField } from '@/ui/pickers';
import { Field, Notice, Segmented, T } from '@/ui/primitives';

const FREQUENCIES = (Object.keys(FREQUENCY_LABEL) as Frequency[]).map((value) => ({ value, label: FREQUENCY_LABEL[value] }));

export default function RecurringScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const data = useData();
  const today = useToday();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.recurrings.find((item) => item.id === params.id) : undefined;

  const [direction, setDirection] = useState<'bill' | 'income'>(existing && existing.amount > 0 ? 'income' : 'bill');
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState<number | null>(existing ? Math.abs(existing.amount) : null);
  const [accountId, setAccountId] = useState(existing?.accountId);
  const [currency, setCurrency] = useState(existing?.currency ?? data.settings.baseCurrency);
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'monthly');
  const [anchorDate, setAnchorDate] = useState(existing?.anchorDate ?? today);
  const [endDate, setEndDate] = useState(existing?.endDate);
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [matchText, setMatchText] = useState(existing?.matchText ?? '');
  const [tolerance, setTolerance] = useState(String(existing?.tolerancePct ?? 10));
  const [status, setStatus] = useState<RecurringStatus>(existing?.status ?? 'active');
  const [attempted, setAttempted] = useState(false);

  const account = data.accounts.find((item) => item.id === accountId);
  const effectiveCurrency = account?.currency ?? currency;
  const errors = {
    name: name.trim() ? null : 'Give it a name.',
    amount: amount && amount > 0 ? null : 'Enter an amount greater than zero.',
  };
  const signed = (amount ?? 0) * (direction === 'income' ? 1 : -1);

  const save = () => {
    setAttempted(true);
    if (errors.name || errors.amount) return;
    const pct = Number(tolerance.replace(',', '.'));
    const input = {
      name: name.trim(),
      amount: signed,
      currency: effectiveCurrency,
      accountId,
      categoryId,
      frequency,
      anchorDate,
      endDate,
      matchText: matchText.trim() || name.trim(),
      tolerancePct: Number.isFinite(pct) && pct >= 0 ? Math.min(100, pct) : 10,
      status,
    };
    if (existing) store.updateRecurring(existing.id, input);
    else store.addRecurring(input);
    toast(existing ? 'Saved' : 'Now tracking');
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Stop tracking ${existing.name}?`,
      message: 'Its past payments stay in your transactions. To keep the history of the schedule, pause it instead.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    store.deleteRecurring(existing.id);
    toast('Deleted');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Recurring">
        <Notice tone="warning" title="This item no longer exists" />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit recurring' : 'New recurring'}
      testID="recurring-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Track it'} />}>
      <Segmented
        value={direction}
        onChange={(next) => {
          setDirection(next);
          setCategoryId(null);
        }}
        options={[
          { value: 'bill', label: 'Bill or subscription' },
          { value: 'income', label: 'Income' },
        ]}
        testID="recurring-direction"
      />
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder={direction === 'income' ? 'e.g. Salary' : 'e.g. Rent'}
        autoCapitalize="words"
        autoFocus={!existing}
        error={attempted ? errors.name : null}
        testID="recurring-name"
      />
      <AmountField label="Amount" value={amount} currency={effectiveCurrency} onChange={setAmount} error={attempted ? errors.amount : null} testID="recurring-amount" />
      <OptionField label="How often" options={FREQUENCIES} value={frequency} onChange={setFrequency} testID="recurring-frequency" />
      {amount && frequency !== 'monthly' ? (
        <T variant="caption" tone="faint">
          That is {formatMoney(Math.abs(monthlyEquivalent({ amount: signed, frequency })), effectiveCurrency)} a month to set aside.
        </T>
      ) : null}
      <DateField
        label={existing ? 'First due date tracked' : 'Next due date'}
        value={anchorDate}
        onChange={(next) => next && setAnchorDate(next)}
        testID="recurring-date"
      />
      <AccountField
        label={direction === 'income' ? 'Paid into' : 'Paid from'}
        value={accountId}
        onChange={setAccountId}
        allowNone="Any account"
      />
      {!account ? <CurrencyField value={currency} onChange={setCurrency} /> : null}
      <CategoryField value={categoryId} onChange={setCategoryId} kind={direction === 'income' ? 'income' : 'expense'} />
      <Field
        label="Recognise payments containing"
        value={matchText}
        onChangeText={setMatchText}
        placeholder={name.trim() || 'Text from your bank statement'}
        autoCapitalize="none"
        hint="A transaction whose payee contains this text, for about this amount, is marked as the payment automatically."
        testID="recurring-match"
      />
      <Field
        label="Amount can vary by"
        value={tolerance}
        onChangeText={setTolerance}
        keyboardType="decimal-pad"
        inputMode="decimal"
        suffix="%"
        hint="Raise this for bills that change every time, like energy."
      />
      <DateField label="Ends" value={endDate} onChange={setEndDate} clearable placeholder="No end date" testID="recurring-end" />
      {existing ? (
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'archived', label: 'Ended' },
          ]}
          testID="recurring-status"
        />
      ) : null}
    </ModalScreen>
  );
}
