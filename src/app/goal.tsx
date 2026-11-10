import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { formatDate } from '@/domain/dates';
import { goalProgress } from '@/domain/goals';
import { formatMoney } from '@/domain/money';
import { CATEGORY_COLORS } from '@/domain/seed';
import { useBalances, useCtx, useData, useToday } from '@/store/hooks';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AccountField, AmountField, DateField, FormActions } from '@/ui/pickers';
import { Button, Card, Field, ListItem, Money, Notice, ProgressBar, Row, SectionTitle, T } from '@/ui/primitives';

export default function GoalScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const data = useData();
  const ctx = useCtx();
  const balances = useBalances();
  const today = useToday();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.goals.find((goal) => goal.id === params.id) : undefined;
  const base = data.settings.baseCurrency;

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? '🎯');
  const [target, setTarget] = useState<number | null>(existing?.targetAmount ?? null);
  const [targetDate, setTargetDate] = useState(existing?.targetDate);
  const [accountId, setAccountId] = useState(existing?.accountId);
  const [contribution, setContribution] = useState<number | null>(null);
  const [contributionKey, setContributionKey] = useState(0);
  const [attempted, setAttempted] = useState(false);

  const progress = existing ? goalProgress(existing, data.accounts, balances, ctx, today) : null;
  const errors = {
    name: name.trim() ? null : 'Give the goal a name.',
    target: target && target > 0 ? null : 'Enter how much you want to save.',
  };

  const save = () => {
    setAttempted(true);
    if (errors.name || errors.target || !target) return;
    const input = { name: name.trim(), icon: icon.trim() || '🎯', targetAmount: target, targetDate, accountId };
    if (existing) store.updateGoal(existing.id, input);
    else store.addGoal({ ...input, createdDate: today, color: CATEGORY_COLORS[data.goals.length % CATEGORY_COLORS.length] });
    toast(existing ? 'Goal saved' : 'Goal added');
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      message: 'The goal and its record of contributions will be removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    store.deleteGoal(existing.id);
    toast('Goal deleted');
    closeScreen();
  };

  const move = (sign: 1 | -1) => {
    if (!existing || !contribution) return;
    store.contribute(existing.id, sign * contribution, today);
    setContribution(null);
    setContributionKey((key) => key + 1);
    toast(sign > 0 ? 'Added to goal' : 'Taken out of goal');
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Goal">
        <Notice tone="warning" title="This goal no longer exists" />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit goal' : 'New goal'}
      testID="goal-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Add goal'} />}
    >
      {existing && progress ? (
        <Card>
          <Row align="flex-end">
            <Money amount={progress.saved} currency={base} variant="title" testID="goal-saved" />
            <T tone="muted">of {formatMoney(progress.target, base, { whole: true })}</T>
          </Row>
          <ProgressBar fraction={progress.fraction} color={existing.color} />
          <T variant="label" tone="muted">
            {progress.state === 'done'
              ? 'You have reached this goal.'
              : progress.monthlyNeeded !== null && existing.targetDate
                ? progress.monthsLeft === 0
                  ? `The target date has passed with ${formatMoney(progress.remaining, base)} still to go.`
                  : `${formatMoney(progress.monthlyNeeded, base)} a month for ${progress.monthsLeft} ${progress.monthsLeft === 1 ? 'month' : 'months'} gets you there by ${formatDate(existing.targetDate, 'long')}.`
                : `${formatMoney(progress.remaining, base)} to go. Add a target date to see how much to put aside each month.`}
          </T>
        </Card>
      ) : null}

      <Row align="flex-start">
        <View style={{ width: 84 }}>
          <Field label="Icon" value={icon} onChangeText={setIcon} maxLength={4} testID="goal-icon" />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Emergency fund"
            autoCapitalize="sentences"
            autoFocus={!existing}
            error={attempted ? errors.name : null}
            testID="goal-name"
          />
        </View>
      </Row>
      <AmountField label="Target" value={target} currency={base} onChange={setTarget} error={attempted ? errors.target : null} testID="goal-target" />
      <DateField label="Target date" value={targetDate} onChange={setTargetDate} clearable placeholder="No deadline" testID="goal-date" />
      <AccountField label="Follow an account" value={accountId} onChange={setAccountId} allowNone="No, I will add to it by hand" testID="goal-account" />
      <T variant="caption" tone="faint">
        {accountId ? 'Progress is the balance of that account, so it updates by itself.' : 'Record each amount you set aside below once the goal is saved.'}
      </T>

      {existing && !existing.accountId ? (
        <>
          <SectionTitle>Add or take out</SectionTitle>
          <AmountField key={contributionKey} label="Amount" value={contribution} currency={base} onChange={setContribution} testID="goal-contribution" />
          <Row>
            <Button label="Take out" kind="secondary" onPress={() => move(-1)} disabled={!contribution} style={{ flex: 1 }} testID="goal-withdraw" />
            <Button label="Add to goal" onPress={() => move(1)} disabled={!contribution} style={{ flex: 1 }} testID="goal-add" />
          </Row>
          {existing.contributions.length > 0 ? (
            <Card padded={false}>
              {[...existing.contributions]
                .reverse()
                .slice(0, 12)
                .map((item) => (
                  <ListItem
                    key={item.id}
                    title={formatDate(item.date, 'long')}
                    trailing={<Money amount={item.amount} currency={base} colored weight="600" />}
                  />
                ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </ModalScreen>
  );
}
