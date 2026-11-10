import { getLocales } from 'expo-localization';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { buildImportRows, inferMapping, inferOptions, readCSV, type ColumnMapping, type Field as CsvField, type ImportOptions } from '@/domain/csv';
import { formatDate, type DateOrder } from '@/domain/dates';
import { formatMoney } from '@/domain/money';
import { findDuplicates } from '@/domain/transactions';
import { showTransactions } from '@/features/shared';
import { pickTextFile } from '@/platform/files';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { ModalScreen } from '@/ui/nav';
import { useToast } from '@/ui/overlays';
import { AccountField, OptionField } from '@/ui/pickers';
import { Button, Card, Field, ListItem, Money, Notice, Pill, SectionTitle, T, ToggleRow } from '@/ui/primitives';

const NONE = 'none';
const COLUMNS: { field: CsvField; label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'payee', label: 'Description' },
  { field: 'amount', label: 'Amount (one column)' },
  { field: 'debit', label: 'Money out' },
  { field: 'credit', label: 'Money in' },
  { field: 'category', label: 'Category' },
  { field: 'notes', label: 'Notes' },
];

function fallbackOrder(): DateOrder {
  try {
    return getLocales()[0]?.regionCode === 'US' ? 'MDY' : 'DMY';
  } catch {
    return 'DMY';
  }
}

export default function ImportScreen() {
  const data = useData();
  const toast = useToast();
  const importTransactions = useStore((state) => state.importTransactions);
  const openAccounts = data.accounts.filter((account) => !account.archived);
  const [accountId, setAccountId] = useState<string | undefined>(openAccounts[0]?.id);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [keepBalance, setKeepBalance] = useState<boolean | null>(null);
  const [includeLikely, setIncludeLikely] = useState(false);

  const account = data.accounts.find((item) => item.id === accountId);
  const currency = account?.currency ?? data.settings.baseCurrency;
  const file = useMemo(() => readCSV(text), [text]);
  const hasHistory = account ? data.transactions.some((tx) => tx.accountId === account.id) : false;
  // Treat a first import as history; later imports as new activity that moves the balance.
  const keep = keepBalance ?? !hasHistory;

  const load = (next: string, name: string | null) => {
    const parsed = readCSV(next);
    const inferred = inferMapping(parsed);
    setText(next);
    setFileName(name);
    setMapping(inferred);
    setOptions(inferOptions(parsed, inferred, currency, fallbackOrder()));
    setIncludeLikely(false);
  };

  const effective = useMemo<ImportOptions>(
    () => ({ ...(options ?? { dateOrder: fallbackOrder(), decimal: 'auto' as const, flipSign: false }), currency }),
    [options, currency],
  );
  const result = useMemo(() => buildImportRows(file, mapping, effective), [file, mapping, effective]);
  const duplicates = useMemo(
    () =>
      accountId
        ? findDuplicates(
            result.rows.map((row) => ({ ...row, accountId })),
            data.transactions,
          )
        : result.rows.map(() => null),
    [result.rows, accountId, data.transactions],
  );
  const chosen = result.rows.filter((_, index) => duplicates[index] === null || (includeLikely && duplicates[index] === 'likely'));
  const exact = duplicates.filter((kind) => kind === 'exact').length;
  const likely = duplicates.filter((kind) => kind === 'likely').length;
  const spending = chosen.filter((row) => row.amount < 0).length;

  const columnOptions = [
    { value: NONE, label: 'Not in this file' },
    ...file.headers.map((header, index) => ({ value: String(index), label: header, hint: file.rows[0]?.[index] ? `e.g. ${file.rows[0][index]}` : undefined })),
  ];
  const setColumn = (field: CsvField, value: string) => {
    const next = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = Number(value);
    setMapping(next);
  };

  const pick = async () => {
    try {
      const picked = await pickTextFile(['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*']);
      if (picked) load(picked.text, picked.name);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not read that file');
    }
  };

  const run = () => {
    if (!account || chosen.length === 0) return;
    const count = importTransactions(account.id, chosen, { keepBalance: keep });
    toast(`Imported ${count} ${count === 1 ? 'transaction' : 'transactions'}`);
    showTransactions({ accountIds: [account.id], needsReview: true });
  };

  if (openAccounts.length === 0) {
    return (
      <ModalScreen title="Import from CSV">
        <Notice tone="accent" title="Add an account first" body="Imported transactions need an account to go into." />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title="Import from CSV"
      testID="import-screen"
      footer={
        <Button
          label={chosen.length > 0 ? `Import ${chosen.length} ${chosen.length === 1 ? 'transaction' : 'transactions'}` : 'Nothing to import yet'}
          onPress={run}
          disabled={chosen.length === 0 || !account}
          testID="run-import"
        />
      }
    >
      <T tone="muted">
        Download a CSV export from your bank&apos;s website or app, from any bank in any country, and bring it in here. Nothing leaves this device.
      </T>
      <AccountField label="Import into" value={accountId} onChange={(id) => setAccountId(id)} />
      <Button label={fileName ? `Chosen: ${fileName}` : 'Choose a CSV file'} kind="secondary" icon="document-outline" onPress={pick} testID="pick-file" />
      <Field
        label="Or paste the file's contents"
        value={text}
        onChangeText={(next) => load(next, null)}
        placeholder={'Date,Description,Amount\n2026-11-03,Corner bakery,-4.50'}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={{ minHeight: 90, maxHeight: 160, textAlignVertical: 'top' }}
        testID="csv-text"
      />

      {file.rows.length > 0 ? (
        <>
          <SectionTitle>Check the columns</SectionTitle>
          <Card>
            {COLUMNS.map((column) => (
              <OptionField
                key={column.field}
                label={column.label}
                options={columnOptions}
                value={mapping[column.field] === undefined ? NONE : String(mapping[column.field])}
                onChange={(value) => setColumn(column.field, value)}
                testID={`map-${column.field}`}
              />
            ))}
            <OptionField
              label="Dates are written"
              value={effective.dateOrder}
              onChange={(dateOrder) => setOptions({ ...effective, dateOrder })}
              options={[
                { value: 'DMY', label: 'Day first', hint: '31/12/2026' },
                { value: 'MDY', label: 'Month first', hint: '12/31/2026' },
                { value: 'YMD', label: 'Year first', hint: '2026-12-31' },
              ]}
              testID="map-date-order"
            />
            <OptionField
              label="Decimals are written"
              value={effective.decimal}
              onChange={(decimal) => setOptions({ ...effective, decimal })}
              options={[
                { value: 'auto', label: 'Work it out' },
                { value: '.', label: 'With a point', hint: '1,234.56' },
                { value: ',', label: 'With a comma', hint: '1.234,56' },
              ]}
            />
            <ToggleRow
              label="Purchases are shown as positive numbers"
              hint={`Right now ${spending} of ${chosen.length} would be recorded as spending. Switch this if that looks the wrong way round.`}
              value={effective.flipSign}
              onChange={(flipSign) => setOptions({ ...effective, flipSign })}
              testID="flip-sign"
            />
          </Card>

          <Notice
            tone={chosen.length > 0 ? 'accent' : 'warning'}
            title={`${chosen.length} to import`}
            body={
              [
                exact > 0 ? `${exact} already in Waypoint and skipped.` : '',
                likely > 0 ? `${likely} look like ones you already have${includeLikely ? ' and will be imported anyway' : ' and are skipped'}.` : '',
                result.errors.length > 0 ? `${result.errors.length} could not be read.` : '',
              ]
                .filter(Boolean)
                .join(' ') || 'Every row was read and none are duplicates.'
            }
          />
          {likely > 0 ? (
            <ToggleRow
              label="Import the likely duplicates too"
              hint="Same amount and merchant within three days of something already recorded, as happens when a pending charge posts."
              value={includeLikely}
              onChange={setIncludeLikely}
              testID="include-likely"
            />
          ) : null}
          <ToggleRow
            label="Keep the account balance as it is"
            hint={
              keep
                ? 'These are treated as history your current balance already includes.'
                : `These are treated as new activity and will change the balance of ${account?.name ?? 'the account'}.`
            }
            value={keep}
            onChange={setKeepBalance}
            testID="keep-balance"
          />

          {result.errors.length > 0 ? (
            <Card>
              <T variant="label" tone="warning">
                Rows that could not be read
              </T>
              {result.errors.slice(0, 5).map((error, index) => (
                <T key={index} variant="label" tone="muted">
                  {error.line > 0 ? `Line ${error.line}: ` : ''}
                  {error.reason}
                </T>
              ))}
              {result.errors.length > 5 ? (
                <T variant="caption" tone="faint">
                  and {result.errors.length - 5} more
                </T>
              ) : null}
            </Card>
          ) : null}

          {result.rows.length > 0 ? (
            <>
              <SectionTitle>Preview</SectionTitle>
              <Card padded={false}>
                {result.rows.slice(0, 8).map((row, index) => (
                  <ListItem
                    key={`${row.line}-${index}`}
                    title={row.payee}
                    subtitle={`${formatDate(row.date, 'long')}${row.categoryName ? ` · ${row.categoryName}` : ''}`}
                    trailing={
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Money amount={row.amount} currency={currency} colored weight="600" />
                        {duplicates[index] === 'exact' ? (
                          <Pill label="Already have it" />
                        ) : duplicates[index] === 'likely' ? (
                          <Pill label="Likely duplicate" tone="warning" />
                        ) : null}
                      </View>
                    }
                  />
                ))}
              </Card>
              {result.rows.length > 8 ? (
                <T variant="caption" tone="faint" center>
                  and {result.rows.length - 8} more · total{' '}
                  {formatMoney(
                    chosen.reduce((sum, row) => sum + row.amount, 0),
                    currency,
                    { sign: 'always' },
                  )}
                </T>
              ) : null}
            </>
          ) : null}
        </>
      ) : text.trim() ? (
        <Notice
          tone="warning"
          title="No rows found"
          body="This does not look like a CSV file. Check that it has one transaction per line with columns separated by commas, semicolons or tabs."
        />
      ) : null}
    </ModalScreen>
  );
}
