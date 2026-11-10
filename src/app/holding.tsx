import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { useData, useToday } from '@/store/hooks';
import { isSynced } from '@/store/ops';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AmountField, FormActions, OptionField } from '@/ui/pickers';
import { Field, Notice, Row, T } from '@/ui/primitives';

export default function HoldingScreen() {
  const params = useLocalSearchParams<{ id?: string; accountId?: string }>();
  const data = useData();
  const today = useToday();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.holdings.find((holding) => holding.id === params.id) : undefined;
  const accounts = data.accounts.filter((account) => account.type === 'investment' && !account.archived && !isSynced(data, account.id));

  const [accountId, setAccountId] = useState(existing?.accountId ?? params.accountId ?? accounts[0]?.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [symbol, setSymbol] = useState(existing?.symbol ?? '');
  const [sharesText, setSharesText] = useState(existing ? String(existing.shares) : '');
  const [value, setValue] = useState<number | null>(existing?.marketValue ?? null);
  const [cost, setCost] = useState<number | null>(existing?.costBasis ?? null);
  const [attempted, setAttempted] = useState(false);

  const account = data.accounts.find((item) => item.id === accountId);
  const currency = existing?.currency ?? account?.currency ?? data.settings.baseCurrency;
  const shares = Number(sharesText.replace(',', '.'));
  const errors = {
    name: name.trim() || symbol.trim() ? null : 'Give it a name or a ticker symbol.',
    shares: sharesText.trim() !== '' && Number.isFinite(shares) && shares > 0 ? null : 'Enter how many shares or units you hold.',
    value: value !== null && value > 0 ? null : 'Enter what the holding is worth now.',
    account: account ? null : 'Choose an investment account.',
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = () => {
    setAttempted(true);
    if (invalid || !account || value === null) return;
    const input = {
      name: name.trim() || symbol.trim().toUpperCase(),
      symbol: symbol.trim().toUpperCase() || undefined,
      shares,
      marketValue: value,
      costBasis: cost && cost > 0 ? cost : undefined,
      updatedAt: today,
    };
    if (existing) store.updateHolding(existing.id, input);
    else store.addHolding({ ...input, accountId: account.id, currency });
    toast(existing ? 'Holding saved' : 'Holding added');
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Remove ${existing.name}?`,
      message: 'The account balance is lowered by what this holding was worth.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    store.deleteHolding(existing.id);
    toast('Holding removed');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Holding">
        <Notice tone="warning" title="This holding no longer exists" />
      </ModalScreen>
    );
  }
  if (accounts.length === 0 && !existing) {
    return (
      <ModalScreen title="New holding">
        <Notice
          tone="accent"
          title="Add an investment account first"
          body="Holdings live inside an investment account. Accounts kept up to date by a bank connection manage their own holdings."
        />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit holding' : 'New holding'}
      testID="holding-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Add holding'} />}
    >
      {!existing ? (
        <OptionField
          label="Account"
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((item) => ({ value: item.id, label: item.name }))}
          placeholder="Choose an account"
        />
      ) : null}
      <Row align="flex-start">
        <View style={{ width: 110 }}>
          <Field
            label="Symbol"
            value={symbol}
            onChangeText={setSymbol}
            placeholder="VWRL"
            autoCapitalize="characters"
            autoCorrect={false}
            testID="holding-symbol"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. World index fund"
            autoCapitalize="words"
            autoFocus={!existing}
            error={attempted ? errors.name : null}
            testID="holding-name"
          />
        </View>
      </Row>
      <Field
        label="Shares or units"
        value={sharesText}
        onChangeText={setSharesText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder="0"
        error={attempted ? errors.shares : null}
        testID="holding-shares"
      />
      <AmountField
        label="Worth now, in total"
        value={value}
        currency={currency}
        onChange={setValue}
        error={attempted ? errors.value : null}
        hint={value && shares > 0 ? `${formatMoney(Math.round(value / shares), currency)} a share` : undefined}
        testID="holding-value"
      />
      <AmountField
        label="What you paid, in total (optional)"
        value={cost}
        currency={currency}
        onChange={setCost}
        hint="Used to show your gain or loss."
        testID="holding-cost"
      />
      <T variant="caption" tone="faint">
        The account&apos;s balance follows the total of its holdings. Update the value whenever you check your statement.
      </T>
    </ModalScreen>
  );
}
