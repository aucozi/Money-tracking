import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BackupError, createBackup, parseBackup, transactionsToCSV } from '@/domain/backup';
import { todayISO } from '@/domain/dates';
import { COMMON_CURRENCIES } from '@/domain/money';
import { sortNewestFirst } from '@/domain/transactions';
import type { ThemePreference } from '@/domain/types';
import { pickTextFile, saveTextFile } from '@/platform/files';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { useConfirm, useToast } from '@/ui/overlays';
import { Button, Card, Field, Glyph, ListItem, Screen, SectionTitle, Segmented, T, ToggleRow } from '@/ui/primitives';
import { space } from '@/ui/theme';

function RateRow({ code, base }: { code: string; base: string }) {
  const rate = useStore((state) => state.data.settings.rates[code]);
  const setRate = useStore((state) => state.setRate);
  const [text, setText] = useState(rate ? String(rate) : '');
  const parsed = Number(text.replace(',', '.'));
  const invalid = text.trim() !== '' && !(parsed > 0);
  return (
    <Field
      label={`1 ${code} is worth`}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const value = Number(next.replace(',', '.'));
        setRate(code, next.trim() === '' || !(value > 0) ? null : value);
      }}
      keyboardType="decimal-pad"
      inputMode="decimal"
      placeholder="Not set"
      suffix={base}
      error={invalid ? 'Enter a number greater than zero.' : null}
      hint={!rate && !invalid ? `Until this is set, ${code} is counted one-for-one with ${base}.` : undefined}
      testID={`rate-${code}`}
    />
  );
}

export default function SettingsScreen() {
  const data = useData();
  const store = useStore.getState();
  const confirm = useConfirm();
  const toast = useToast();
  const base = data.settings.baseCurrency;
  const foreign = [...new Set([...data.accounts.map((account) => account.currency), ...Object.keys(data.settings.rates)])].filter((code) => code !== base).sort();
  const baseName = COMMON_CURRENCIES.find((currency) => currency.code === base)?.name;

  const guard = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      toast(error instanceof BackupError || error instanceof Error ? error.message : 'Something went wrong');
    }
  };

  const exportAll = () =>
    guard(async () => {
      await saveTextFile(`waypoint-transactions-${todayISO()}.csv`, transactionsToCSV(sortNewestFirst(data.transactions), data), 'text/csv');
      toast(`Exported ${data.transactions.length} transactions`);
    });

  const backup = () =>
    guard(async () => {
      await saveTextFile(`waypoint-backup-${todayISO()}.json`, createBackup(data), 'application/json');
      toast('Backup saved');
    });

  const restore = () =>
    guard(async () => {
      const picked = await pickTextFile(['application/json', 'text/plain', '*/*']);
      if (!picked) return;
      const restored = parseBackup(picked.text);
      const ok = await confirm({
        title: 'Replace everything with this backup?',
        message: `The backup holds ${restored.accounts.length} accounts and ${restored.transactions.length} transactions. What is in Waypoint now will be replaced.`,
        confirmLabel: 'Restore',
        destructive: true,
      });
      if (!ok) return;
      store.restore(restored);
      toast('Backup restored');
    });

  const sample = async () => {
    const ok = await confirm({
      title: 'Load sample data?',
      message: data.transactions.length > 0 ? 'This replaces everything in Waypoint now. Save a backup first if you want to keep it.' : 'Fills Waypoint with an invented household so you can look around.',
      confirmLabel: 'Load sample data',
      destructive: data.transactions.length > 0,
    });
    if (!ok) return;
    store.loadDemo(base, todayISO());
    toast('Sample data loaded');
  };

  const erase = async () => {
    const ok = await confirm({
      title: 'Erase everything?',
      message: 'All accounts, transactions, budgets, bills, goals and rules are deleted from this device. There is no copy anywhere else unless you saved a backup.',
      confirmLabel: 'Erase everything',
      destructive: true,
    });
    if (!ok) return;
    store.eraseEverything();
  };

  return (
    <Screen edges={['bottom']} testID="settings-screen">
      <SectionTitle>Appearance</SectionTitle>
      <Segmented<ThemePreference>
        value={data.settings.theme}
        onChange={(theme) => store.updateSettings({ theme })}
        options={[
          { value: 'system', label: 'Match device' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        testID="theme-setting"
      />

      <SectionTitle>Currencies</SectionTitle>
      <Card>
        <View>
          <T variant="label" tone="muted">
            Main currency
          </T>
          <T variant="heading">
            {base}
            {baseName ? ` · ${baseName}` : ''}
          </T>
          <T variant="caption" tone="faint">
            Budgets, goals and totals are kept in this currency, so it is fixed once you start. Accounts can use any currency.
          </T>
        </View>
        {foreign.length === 0 ? (
          <T variant="label" tone="muted">
            Add an account in another currency and its exchange rate appears here.
          </T>
        ) : (
          foreign.map((code) => <RateRow key={code} code={code} base={base} />)
        )}
        {foreign.length > 0 ? (
          <T variant="caption" tone="faint">
            Rates are yours to set and never fetched, so nothing about your money leaves the device. Use the rate your bank gave you.
          </T>
        ) : null}
      </Card>

      <SectionTitle>Planning</SectionTitle>
      <Card>
        <ToggleRow
          label="Plan every bit of income"
          hint="Zero-based budgeting: the Budget tab shows income left to assign. Off, it simply tracks spending against limits."
          value={data.settings.budgetMode === 'zero'}
          onChange={(on) => store.updateSettings({ budgetMode: on ? 'zero' : 'tracking' })}
          testID="zero-setting"
        />
        <ToggleRow
          label="Forecast includes everyday spending"
          hint="Subtracts your typical daily spending from the projected balance, not just tracked bills."
          value={data.settings.forecastEverydaySpending}
          onChange={(value) => store.updateSettings({ forecastEverydaySpending: value })}
        />
      </Card>

      <SectionTitle>Organise</SectionTitle>
      <Card padded={false}>
        <ListItem title="Categories" subtitle={`${data.categories.filter((category) => !category.archived).length} in ${data.categoryGroups.length} groups`} leading={<Glyph icon="🏷️" />} onPress={() => router.push('/categories')} testID="open-categories" />
        <ListItem title="Rules" subtitle={data.rules.length === 0 ? 'Tidy up transactions automatically' : `${data.rules.length} ${data.rules.length === 1 ? 'rule' : 'rules'}, all yours to edit`} leading={<Glyph icon="⚙️" />} onPress={() => router.push('/rules')} testID="open-rules" />
        <ListItem title="Import from CSV" subtitle="Bring in transactions from any bank" leading={<Glyph icon="📥" />} onPress={() => router.push('/import')} />
      </Card>

      <SectionTitle>Your data</SectionTitle>
      <Card padded={false}>
        <ListItem title="Export all transactions" subtitle="A CSV file for a spreadsheet or your accountant" leading={<Glyph icon="📤" />} onPress={exportAll} testID="export-all" />
        <ListItem title="Save a backup" subtitle="Everything in one file you control" leading={<Glyph icon="💾" />} onPress={backup} testID="save-backup" />
        <ListItem title="Restore from a backup" subtitle="Replaces what is here now" leading={<Glyph icon="♻️" />} onPress={restore} testID="restore-backup" />
        <ListItem title="Load sample data" subtitle="An invented household to explore with" leading={<Glyph icon="🧪" />} onPress={sample} testID="load-sample" />
      </Card>
      <T variant="caption" tone="faint">
        Waypoint keeps your data on this device only. There is no account and no server, which also means no automatic copy: save a backup now and then, and before
        changing phone.
      </T>

      <View style={styles.danger}>
        <Button label="Erase everything" kind="danger" icon="trash-outline" onPress={erase} testID="erase-all" />
      </View>
      <T variant="caption" tone="faint" center>
        Waypoint {Constants.expoConfig?.version ?? '1.0.0'}
      </T>
    </Screen>
  );
}

const styles = StyleSheet.create({ danger: { marginTop: space.lg } });
