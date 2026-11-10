import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { addDays, addMonthsToKey, dayOfWeek, formatDate, formatMonth, monthKey, monthLength, monthStart, todayISO } from '@/domain/dates';
import { COMMON_CURRENCIES, formatMoney, parseAmount, toInputString } from '@/domain/money';
import type { Account, Category, CategoryKind, ISODate } from '@/domain/types';
import { useBalances, useData } from '@/store/hooks';

import { Icon } from './icon';
import { Sheet } from './overlays';
import { Button, Card, Chip, Field, Glyph, IconButton, ListItem, PickerField, Row, T } from './primitives';
import { space, useTheme } from './theme';

export interface Option<V extends string> {
  value: V;
  label: string;
  hint?: string;
  leading?: ReactNode;
}

/** A field that opens a list of choices. */
export function OptionField<V extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  testID,
}: {
  label: string;
  options: Option<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  placeholder?: string;
  testID?: string;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <PickerField label={label} value={current?.label} placeholder={placeholder} leading={current?.leading} onPress={() => setOpen(true)} testID={testID} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <Card padded={false}>
          {options.map((option) => (
            <ListItem
              key={option.value}
              title={option.label}
              subtitle={option.hint}
              leading={option.leading}
              selected={option.value === value}
              trailing={option.value === value ? <Icon name="checkmark" size={18} color={c.accent} /> : undefined}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))}
        </Card>
      </Sheet>
    </>
  );
}

export function CurrencyField({ label = 'Currency', value, onChange }: { label?: string; value: string; onChange: (code: string) => void }) {
  const options = COMMON_CURRENCIES.map((currency) => ({ value: currency.code, label: `${currency.code} · ${currency.name}` }));
  if (!options.some((option) => option.value === value)) options.unshift({ value, label: value });
  return <OptionField label={label} options={options} value={value} onChange={onChange} testID="currency-field" />;
}

export function AccountField({
  label = 'Account',
  value,
  onChange,
  exclude,
  allowNone,
  testID,
}: {
  label?: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  exclude?: string;
  /** Offer a "none" choice with this label. */
  allowNone?: string;
  testID?: string;
}) {
  const data = useData();
  const balances = useBalances();
  const accounts = data.accounts.filter((account) => (!account.archived || account.id === value) && account.id !== exclude);
  const options: Option<string>[] = accounts.map((account: Account) => ({
    value: account.id,
    label: account.name,
    hint: formatMoney(balances.get(account.id) ?? 0, account.currency),
  }));
  if (allowNone) options.unshift({ value: '', label: allowNone });
  return (
    <OptionField
      label={label}
      options={options}
      value={value ?? (allowNone ? '' : undefined)}
      onChange={(id) => onChange(id || undefined)}
      placeholder="Choose an account"
      testID={testID ?? 'account-field'}
    />
  );
}

/** Pick a category from its groups. `kind` narrows the list to expenses or income. */
export function CategorySheet({
  visible,
  onClose,
  onPick,
  kind,
  selected,
  title = 'Category',
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (id: string | null) => void;
  kind?: CategoryKind;
  selected?: string | null;
  title?: string;
}) {
  const { c } = useTheme();
  const data = useData();
  const groups = [...data.categoryGroups].sort((a, b) => a.sort - b.sort).filter((group) => !kind || group.kind === kind);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="category-sheet">
      <Card padded={false}>
        <ListItem title="Uncategorized" leading={<Glyph icon="❔" />} selected={selected === null} onPress={() => onPick(null)} />
      </Card>
      {groups.map((group) => {
        const categories = data.categories
          .filter((category) => category.groupId === group.id && (!category.archived || category.id === selected))
          .sort((a, b) => a.sort - b.sort);
        if (categories.length === 0) return null;
        return (
          <View key={group.id} style={styles.group}>
            <T variant="caption" tone="faint">
              {group.name.toUpperCase()}
            </T>
            <Card padded={false}>
              {categories.map((category: Category) => (
                <ListItem
                  key={category.id}
                  title={category.name}
                  leading={<Glyph icon={category.icon} color={category.color} />}
                  selected={category.id === selected}
                  trailing={category.id === selected ? <Icon name="checkmark" size={18} color={c.accent} /> : undefined}
                  onPress={() => onPick(category.id)}
                  testID={`pick-${category.id}`}
                />
              ))}
            </Card>
          </View>
        );
      })}
    </Sheet>
  );
}

export function CategoryField({
  label = 'Category',
  value,
  onChange,
  kind,
  testID,
}: {
  label?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  kind?: CategoryKind;
  testID?: string;
}) {
  const data = useData();
  const [open, setOpen] = useState(false);
  const category = data.categories.find((item) => item.id === value);
  return (
    <>
      <PickerField
        label={label}
        value={category?.name}
        placeholder="Uncategorized"
        leading={category ? <Glyph icon={category.icon} color={category.color} size={28} /> : undefined}
        onPress={() => setOpen(true)}
        testID={testID ?? 'category-field'}
      />
      <CategorySheet
        visible={open}
        kind={kind}
        selected={value}
        onClose={() => setOpen(false)}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
      />
    </>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month grid. Built in-app so dates behave identically on every platform. */
export function Calendar({ value, onChange }: { value: ISODate; onChange: (date: ISODate) => void }) {
  const { c } = useTheme();
  const [month, setMonth] = useState(() => monthKey(value));
  const today = todayISO();
  const first = monthStart(month);
  const offset = (dayOfWeek(first) + 6) % 7; // Monday-first
  const cells: (ISODate | null)[] = [...new Array<null>(offset).fill(null), ...Array.from({ length: monthLength(month) }, (_, index) => addDays(first, index))];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={styles.calendar}>
      <Row>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => setMonth(addMonthsToKey(month, -1))} />
        <T variant="heading" center style={styles.flex}>
          {formatMonth(month)}
        </T>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => setMonth(addMonthsToKey(month, 1))} />
      </Row>
      <Row gap={0}>
        {WEEKDAYS.map((day, index) => (
          <T key={index} variant="caption" tone="faint" center style={styles.flex}>
            {day}
          </T>
        ))}
      </Row>
      {Array.from({ length: cells.length / 7 }, (_, week) => (
        <Row key={week} gap={0}>
          {cells.slice(week * 7, week * 7 + 7).map((date, index) => {
            if (!date) return <View key={index} style={styles.day} />;
            const selected = date === value;
            return (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={formatDate(date, 'long')}
                accessibilityState={{ selected }}
                onPress={() => onChange(date)}
                style={styles.day}
              >
                <View
                  style={[styles.dayInner, selected && { backgroundColor: c.accent }, !selected && date === today && { borderColor: c.accent, borderWidth: 1 }]}
                >
                  <T numeric variant="label" style={{ color: selected ? c.onAccent : c.text }}>
                    {Number(date.slice(8, 10))}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </Row>
      ))}
    </View>
  );
}

export function DateField({
  label = 'Date',
  value,
  onChange,
  clearable,
  placeholder,
  testID,
}: {
  label?: string;
  value: ISODate | undefined;
  onChange: (date: ISODate | undefined) => void;
  clearable?: boolean;
  placeholder?: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const pick = (date: ISODate | undefined) => {
    onChange(date);
    setOpen(false);
  };
  return (
    <>
      <PickerField
        label={label}
        value={value ? formatDate(value, 'long') : undefined}
        placeholder={placeholder ?? 'Choose a date'}
        onPress={() => setOpen(true)}
        testID={testID ?? 'date-field'}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <Row style={styles.wrap}>
          <Chip label="Today" selected={value === today} onPress={() => pick(today)} />
          <Chip label="Yesterday" selected={value === addDays(today, -1)} onPress={() => pick(addDays(today, -1))} />
          {clearable ? <Chip label="No date" selected={!value} onPress={() => pick(undefined)} /> : null}
        </Row>
        <Calendar value={value ?? today} onChange={pick} />
      </Sheet>
    </>
  );
}

/** A money input. Reports minor units, or null while the text is not a number. */
export function AmountField({
  label,
  value,
  currency,
  onChange,
  hint,
  error,
  autoFocus,
  testID,
}: {
  label: string;
  value: number | null;
  currency: string;
  onChange: (minor: number | null) => void;
  hint?: string;
  error?: string | null;
  autoFocus?: boolean;
  testID?: string;
}) {
  const [text, setText] = useState(() => (value === null || value === 0 ? '' : toInputString(value, currency)));
  return (
    <Field
      label={label}
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseAmount(next, currency);
        onChange(parsed === null ? null : Math.abs(parsed));
      }}
      keyboardType="decimal-pad"
      inputMode="decimal"
      placeholder="0.00"
      suffix={currency}
      hint={hint}
      error={error}
      autoFocus={autoFocus}
      testID={testID}
    />
  );
}

/** Step backwards and forwards through months. */
export function MonthSwitcher({ month, onChange, max }: { month: string; onChange: (month: string) => void; max?: string }) {
  return (
    <Row style={styles.monthSwitcher}>
      <IconButton icon="chevron-back" label="Previous month" onPress={() => onChange(addMonthsToKey(month, -1))} filled />
      <T variant="heading" center style={styles.flex} accessibilityLiveRegion="polite">
        {formatMonth(month)}
      </T>
      <IconButton
        icon="chevron-forward"
        label="Next month"
        onPress={() => onChange(addMonthsToKey(month, 1))}
        disabled={max !== undefined && month >= max}
        filled
      />
    </Row>
  );
}

/** Save and delete buttons for the bottom of an editing screen. */
export function FormActions({
  onSave,
  onDelete,
  saveLabel = 'Save',
  disabled,
}: {
  onSave: () => void;
  onDelete?: () => void;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Row>
      {onDelete ? <Button label="Delete" kind="danger" icon="trash-outline" onPress={onDelete} testID="delete-button" /> : null}
      <Button label={saveLabel} onPress={onSave} disabled={disabled} style={styles.flex} testID="save-button" />
    </Row>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  calendar: { gap: space.sm },
  day: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayInner: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexWrap: 'wrap' },
  monthSwitcher: { marginVertical: space.xs },
});
