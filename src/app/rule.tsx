import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { previewRule, ruleHasActions, ruleHasConditions } from '@/domain/rules';
import { parseTags } from '@/domain/transactions';
import type { PayeeMatch, Rule } from '@/domain/types';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { AccountField, AmountField, CategoryField, OptionField } from '@/ui/pickers';
import { Button, Field, Notice, Row, SectionTitle, Segmented, T, ToggleRow } from '@/ui/primitives';

type Direction = 'any' | 'expense' | 'income';

export default function RuleScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const data = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.rules.find((rule) => rule.id === params.id) : undefined;
  const base = data.settings.baseCurrency;

  const [payeeText, setPayeeText] = useState(existing?.conditions.payeeText ?? '');
  const [payeeMatch, setPayeeMatch] = useState<PayeeMatch>(existing?.conditions.payeeMatch ?? 'contains');
  const [amountMin, setAmountMin] = useState<number | null>(existing?.conditions.amountMin ?? null);
  const [amountMax, setAmountMax] = useState<number | null>(existing?.conditions.amountMax ?? null);
  const [direction, setDirection] = useState<Direction>(existing?.conditions.direction ?? 'any');
  const [accountId, setAccountId] = useState(existing?.conditions.accountId);
  const [categoryId, setCategoryId] = useState<string | null>(existing?.actions.categoryId ?? null);
  const [renameTo, setRenameTo] = useState(existing?.actions.renameTo ?? '');
  const [tags, setTags] = useState(existing?.actions.addTags?.join(', ') ?? '');
  const [markReviewed, setMarkReviewed] = useState(existing?.actions.markReviewed ?? false);
  const [markTransfer, setMarkTransfer] = useState(existing?.actions.markTransfer ?? false);
  const [attempted, setAttempted] = useState(false);

  const draft: Rule = useMemo(
    () => ({
      id: existing?.id ?? 'draft',
      enabled: existing?.enabled ?? true,
      conditions: {
        payeeText: payeeText.trim() || undefined,
        payeeMatch,
        amountMin: amountMin ?? undefined,
        amountMax: amountMax ?? undefined,
        direction: direction === 'any' ? undefined : direction,
        accountId,
      },
      actions: {
        categoryId: markTransfer ? undefined : (categoryId ?? undefined),
        renameTo: renameTo.trim() || undefined,
        addTags: parseTags(tags).length > 0 ? parseTags(tags) : undefined,
        markReviewed: markReviewed || undefined,
        markTransfer: markTransfer || undefined,
      },
    }),
    [existing, payeeText, payeeMatch, amountMin, amountMax, direction, accountId, categoryId, renameTo, tags, markReviewed, markTransfer],
  );
  const matches = useMemo(() => previewRule(draft, data.transactions).length, [draft, data.transactions]);
  const problem = !ruleHasConditions(draft)
    ? 'Add at least one condition, otherwise the rule would apply to everything.'
    : !ruleHasActions(draft)
      ? 'Choose at least one thing for the rule to do.'
      : amountMin !== null && amountMax !== null && amountMin > amountMax
        ? 'The smallest amount is larger than the largest.'
        : null;

  const save = (apply: boolean) => {
    setAttempted(true);
    if (problem) return;
    const { id: _id, ...body } = draft;
    const id = existing ? existing.id : store.addRule(body);
    if (existing) store.updateRule(existing.id, body);
    if (apply) {
      const changed = store.applyRuleToExisting(id);
      toast(`Rule saved · ${changed} ${changed === 1 ? 'transaction' : 'transactions'} updated`);
    } else {
      toast('Rule saved');
    }
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({ title: 'Delete this rule?', message: 'Transactions it already changed stay as they are.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    store.deleteRule(existing.id);
    toast('Rule deleted');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Rule">
        <Notice tone="warning" title="This rule no longer exists" />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit rule' : 'New rule'}
      testID="rule-screen"
      footer={
        <View style={{ gap: 8 }}>
          <Row>
            {existing ? <Button label="Delete" kind="danger" icon="trash-outline" onPress={remove} testID="delete-button" /> : null}
            <Button label="Save" kind="secondary" onPress={() => save(false)} style={{ flex: 1 }} testID="save-button" />
          </Row>
          <Button
            label={matches > 0 ? `Save and apply to ${matches} existing` : 'Save and apply to existing'}
            onPress={() => save(true)}
            disabled={matches === 0}
            testID="save-apply-button"
          />
        </View>
      }>
      <SectionTitle>When a transaction…</SectionTitle>
      <Field
        label="Payee text"
        value={payeeText}
        onChangeText={setPayeeText}
        placeholder="e.g. cityride"
        autoCapitalize="none"
        autoCorrect={false}
        hint="Compared with both the cleaned-up name and the original text from your bank. Capitals and punctuation are ignored."
        testID="rule-payee"
      />
      <Segmented
        value={payeeMatch}
        onChange={setPayeeMatch}
        options={[
          { value: 'contains', label: 'Contains' },
          { value: 'startsWith', label: 'Starts with' },
          { value: 'exact', label: 'Is exactly' },
        ]}
      />
      <Row align="flex-start">
        <View style={{ flex: 1 }}>
          <AmountField label="Amount at least" value={amountMin} currency={base} onChange={setAmountMin} testID="rule-min" />
        </View>
        <View style={{ flex: 1 }}>
          <AmountField label="Amount at most" value={amountMax} currency={base} onChange={setAmountMax} testID="rule-max" />
        </View>
      </Row>
      <OptionField
        label="Direction"
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'any', label: 'Money in or out' },
          { value: 'expense', label: 'Money going out' },
          { value: 'income', label: 'Money coming in' },
        ]}
      />
      <AccountField label="In account" value={accountId} onChange={setAccountId} allowNone="Any account" />

      <SectionTitle>…then</SectionTitle>
      {!markTransfer ? <CategoryField label="Set the category to" value={categoryId} onChange={setCategoryId} testID="rule-category" /> : null}
      <Field label="Rename the payee to" value={renameTo} onChangeText={setRenameTo} placeholder="Leave empty to keep the name" autoCapitalize="words" testID="rule-rename" />
      <Field label="Add tags" value={tags} onChangeText={setTags} placeholder="e.g. work, reimbursable" autoCapitalize="none" testID="rule-tags" />
      <ToggleRow label="Mark as a transfer" hint="Leaves it out of spending and income, e.g. card repayments." value={markTransfer} onChange={setMarkTransfer} testID="rule-transfer" />
      <ToggleRow label="Mark as reviewed" hint="Skips the review inbox for transactions you never need to check." value={markReviewed} onChange={setMarkReviewed} testID="rule-reviewed" />

      <T variant="label" tone="muted" testID="rule-matches">
        {ruleHasConditions(draft)
          ? `Matches ${matches} ${matches === 1 ? 'transaction' : 'transactions'} you already have.`
          : 'Add a condition to see how many transactions it matches.'}
      </T>
      {attempted && problem ? <Notice tone="negative" title="Not quite ready" body={problem} /> : null}
    </ModalScreen>
  );
}
