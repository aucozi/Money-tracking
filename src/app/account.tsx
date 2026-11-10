import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { formatMoney, hasRate } from '@/domain/money';
import { isLiability, type AccountType } from '@/domain/types';
import { ACCOUNT_TYPES, showTransactions } from '@/features/shared';
import { useBalances, useData, useToday } from '@/store/hooks';
import { isSynced } from '@/store/ops';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AmountField, CurrencyField, FormActions, OptionField } from '@/ui/pickers';
import { Button, Field, Notice, Segmented, T, ToggleRow } from '@/ui/primitives';

export default function AccountScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const data = useData();
  const balances = useBalances();
  const today = useToday();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.accounts.find((account) => account.id === params.id) : undefined;
  const currentBalance = existing ? (balances.get(existing.id) ?? 0) : 0;
  const count = existing ? data.transactions.filter((tx) => tx.accountId === existing.id).length : 0;
  const synced = existing ? isSynced(data, existing.id) : false;

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'checking');
  const [currency, setCurrency] = useState(existing?.currency ?? data.settings.baseCurrency);
  const [balance, setBalance] = useState<number | null>(Math.abs(currentBalance));
  const [owed, setOwed] = useState<'owned' | 'owed'>(existing ? (currentBalance < 0 ? 'owed' : 'owned') : 'owned');
  const [apr, setApr] = useState(existing?.apr !== undefined ? String(existing.apr) : '');
  const [minPayment, setMinPayment] = useState<number | null>(existing?.minPayment ?? null);
  const [include, setInclude] = useState(existing?.includeInNetWorth ?? true);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [attempted, setAttempted] = useState(false);

  const liability = isLiability({ type });
  const nameError = name.trim() ? null : 'Give the account a name.';
  const signed = (balance ?? 0) * (owed === 'owed' ? -1 : 1);
  const foreign = currency !== data.settings.baseCurrency;

  const save = () => {
    setAttempted(true);
    if (nameError) return;
    const details = {
      name: name.trim(),
      type,
      includeInNetWorth: include,
      apr: liability && apr.trim() !== '' && Number.isFinite(Number(apr.replace(',', '.'))) ? Number(apr.replace(',', '.')) : undefined,
      minPayment: liability && minPayment ? minPayment : undefined,
    };
    if (existing) {
      store.updateAccount(existing.id, {
        ...details,
        archived,
        ...(count === 0 ? { currency } : {}),
      });
      if (!synced && signed !== currentBalance) store.reconcileAccount(existing.id, signed);
      toast('Account saved');
    } else {
      store.addAccount({
        ...details,
        currency,
        openingBalance: signed,
        openingDate: today,
      });
      toast('Account added');
    }
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      message:
        count > 0
          ? `Its ${count} ${count === 1 ? 'transaction' : 'transactions'} will be deleted with it. To keep the history, close the account instead.`
          : 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    store.deleteAccount(existing.id);
    toast('Account deleted');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Account">
        <Notice tone="warning" title="This account no longer exists" />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit account' : 'New account'}
      testID="account-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Add account'} />}
    >
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Everyday account"
        autoCapitalize="words"
        autoFocus={!existing}
        error={attempted ? nameError : null}
        testID="account-name"
      />
      <OptionField
        label="Type"
        value={type}
        onChange={(next) => {
          setType(next);
          if (!existing) setOwed(isLiability({ type: next }) ? 'owed' : 'owned');
        }}
        options={ACCOUNT_TYPES.map((item) => ({
          value: item.type,
          label: `${item.icon}  ${item.label}`,
        }))}
        testID="account-type"
      />
      {existing && count > 0 ? (
        <T variant="caption" tone="faint">
          Currency: {currency}. It cannot be changed once the account has transactions.
        </T>
      ) : (
        <CurrencyField value={currency} onChange={setCurrency} />
      )}
      {foreign && !hasRate(currency, data.settings.baseCurrency, data.settings.rates) ? (
        <Notice
          tone="warning"
          title={`No exchange rate for ${currency} yet`}
          body={`Add one in Settings so this account is counted correctly in ${data.settings.baseCurrency} totals.`}
        />
      ) : null}

      {synced ? (
        <Notice
          tone="positive"
          title="Kept up to date by your bank connection"
          body={`The balance, ${formatMoney(currentBalance, currency)}, comes from the bank on every sync, so it is not edited here.`}
        />
      ) : null}
      {existing?.type === 'investment' ? <Button label="See its holdings" kind="ghost" onPress={() => router.push('/investments')} /> : null}
      {synced ? null : (
        <>
          <AmountField
            label={existing ? 'Balance today' : 'Current balance'}
            value={balance}
            currency={currency}
            onChange={setBalance}
            hint={
              existing
                ? `Waypoint has ${formatMoney(currentBalance, currency)}. Type what your bank shows to bring it into line; no transaction is added.`
                : 'What the account shows right now. You can import older transactions afterwards without changing it.'
            }
            testID="account-balance"
          />
          <Segmented
            value={owed}
            onChange={setOwed}
            options={[
              { value: 'owned', label: 'I have this' },
              { value: 'owed', label: 'I owe this' },
            ]}
            testID="account-sign"
          />
        </>
      )}

      {liability ? (
        <>
          <Field
            label="Interest rate (APR)"
            value={apr}
            onChangeText={setApr}
            placeholder="e.g. 21.9"
            keyboardType="decimal-pad"
            inputMode="decimal"
            suffix="%"
            hint="Used by the debt payoff planner."
            testID="account-apr"
          />
          <AmountField label="Minimum monthly payment" value={minPayment} currency={currency} onChange={setMinPayment} testID="account-min-payment" />
        </>
      ) : null}

      <ToggleRow label="Count in net worth" value={include} onChange={setInclude} />
      {existing ? (
        <>
          <ToggleRow
            label="Closed"
            hint="Hides the account from pickers and totals but keeps its history."
            value={archived}
            onChange={setArchived}
            testID="account-archived"
          />
          <Button
            label={`See its ${count} ${count === 1 ? 'transaction' : 'transactions'}`}
            kind="ghost"
            onPress={() => showTransactions({ accountIds: [existing.id] })}
            disabled={count === 0}
          />
        </>
      ) : null}
    </ModalScreen>
  );
}
