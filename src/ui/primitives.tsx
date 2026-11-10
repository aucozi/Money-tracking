import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatMoney, type FormatOptions } from '@/domain/money';

import { radius, space, useTheme, type Palette } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
type Tone = 'text' | 'muted' | 'faint' | 'accent' | 'positive' | 'negative' | 'warning' | 'onAccent';

const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
};

function toneColor(c: Palette, tone: Tone): string {
  if (tone === 'muted') return c.textMuted;
  if (tone === 'faint') return c.textFaint;
  if (tone === 'text') return c.text;
  return c[tone];
}

export interface TProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Line up digits in columns; use for every amount. */
  numeric?: boolean;
  weight?: TextStyle['fontWeight'];
  center?: boolean;
}

export function T({ variant = 'body', tone = 'text', numeric, weight, center, style, ...rest }: TProps) {
  const { c } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        VARIANTS[variant],
        { color: toneColor(c, tone) },
        numeric && styles.numeric,
        weight ? { fontWeight: weight } : null,
        center && styles.center,
        style,
      ]}
    />
  );
}

export interface MoneyProps extends Omit<TProps, 'children'> {
  amount: number;
  currency: string;
  /** Colour by direction: green for money in, default for money out. */
  colored?: boolean;
  options?: FormatOptions;
}

export function Money({ amount, currency, colored, options, tone, ...rest }: MoneyProps) {
  const resolved: Tone = tone ?? (colored && amount > 0 ? 'positive' : 'text');
  return (
    <T numeric tone={resolved} {...rest}>
      {formatMoney(amount, currency, { sign: colored ? 'always' : 'auto', ...options })}
    </T>
  );
}

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  footer,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
  footer?: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: c.bg }]} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.column}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.column]}>{children}</View>
      )}
      {footer ? <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, padded && styles.cardPadded, style]}>
      {children}
    </View>
  );
}

export function Row({ children, style, gap = space.md, align = 'center' }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems'] }) {
  return <View style={[styles.row, { gap, alignItems: align }, style]}>{children}</View>;
}

export function Spacer({ size = space.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Divider() {
  const { c } = useTheme();
  return <View style={[styles.divider, { backgroundColor: c.border }]} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Row style={styles.sectionTitle}>
      <T variant="heading" style={styles.flex} accessibilityRole="header">
        {children}
      </T>
      {action}
    </Row>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  small,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { c } = useTheme();
  const background = kind === 'primary' ? c.accent : kind === 'danger' ? c.negativeSoft : kind === 'secondary' ? c.surfaceAlt : 'transparent';
  const color = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.negative : kind === 'ghost' ? c.accent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={color} /> : null}
      <Text style={[small ? VARIANTS.label : VARIANTS.heading, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'text',
  filled,
  size = 22,
  disabled,
  testID,
}: {
  icon: IconName;
  /** Read out by screen readers; every icon-only button needs one. */
  label: string;
  onPress: () => void;
  tone?: Tone;
  filled?: boolean;
  size?: number;
  disabled?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.iconButton,
        filled && { backgroundColor: c.surfaceAlt },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}>
      <Ionicons name={icon} size={size} color={toneColor(c, tone)} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  testID?: string;
}) {
  const { c } = useTheme();
  const color = selected ? c.onAccent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      testID={testID}
      style={[styles.chip, { backgroundColor: selected ? c.accent : c.surface, borderColor: selected ? c.accent : c.border }]}>
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[VARIANTS.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]} accessibilityRole="tablist" testID={testID}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && { backgroundColor: c.surface }, active && styles.segmentActive]}>
            <Text numberOfLines={1} style={[VARIANTS.label, { color: active ? c.text : c.textMuted }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ fraction, color, height = 8 }: { fraction: number; color?: string; height?: number }) {
  const { c } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.progressTrack, { backgroundColor: c.surfaceAlt, height, borderRadius: height / 2 }]}>
      <View style={{ width: `${clamped * 100}%`, height, borderRadius: height / 2, backgroundColor: color ?? c.accent }} />
    </View>
  );
}

export interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: string;
}

export function Field({ label, hint, error, suffix, style, onFocus, onBlur, ...rest }: FieldProps) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <T variant="label" tone="muted">
        {label}
      </T>
      <View
        style={[
          styles.inputWrap,
          { backgroundColor: c.surface, borderColor: error ? c.negative : focused ? c.accent : c.border },
          (focused || error) && styles.inputWrapActive,
        ]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.textFaint}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, { color: c.text }, webNoOutline, style]}
        />
        {suffix ? (
          <T variant="label" tone="faint">
            {suffix}
          </T>
        ) : null}
      </View>
      {error ? (
        <T variant="caption" tone="negative">
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" tone="faint">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** A tappable row that shows a value and opens a picker. */
export function PickerField({
  label,
  value,
  placeholder,
  onPress,
  leading,
  testID,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress: () => void;
  leading?: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.field}>
      <T variant="label" tone="muted">
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder || 'not set'}`}
        onPress={onPress}
        testID={testID}
        style={[styles.inputWrap, styles.pickerWrap, { backgroundColor: c.surface, borderColor: c.border }]}>
        {leading}
        <T style={styles.flex} tone={value ? 'text' : 'faint'} numberOfLines={1}>
          {value || placeholder || 'Choose'}
        </T>
        <Ionicons name="chevron-down" size={18} color={c.textFaint} />
      </Pressable>
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  const { c } = useTheme();
  return (
    <Row style={styles.toggleRow}>
      <View style={styles.flex}>
        <T>{label}</T>
        {hint ? (
          <T variant="caption" tone="faint">
            {hint}
          </T>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        testID={testID}
        trackColor={{ true: c.accent, false: c.border }}
      />
    </Row>
  );
}

export function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  onLongPress,
  selected,
  testID,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const content = (
    <>
      {leading}
      <View style={styles.flex}>
        <T numberOfLines={1}>{title}</T>
        {subtitle ? (
          <T variant="caption" tone="faint" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {trailing}
    </>
  );
  if (!onPress && !onLongPress) return <View style={styles.listItem}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={({ pressed }) => [styles.listItem, (pressed || selected) && { backgroundColor: selected ? c.accentSoft : c.surfaceAlt }]}>
      {content}
    </Pressable>
  );
}

/** A round badge holding a category's emoji. */
export function Glyph({ icon, color, size = 36 }: { icon: string; color?: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.glyph,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color ? `${color}26` : c.surfaceAlt },
      ]}>
      <Text style={{ fontSize: size * 0.5 }}>{icon}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'positive' | 'negative' | 'warning' | 'accent' }) {
  const { c } = useTheme();
  const background =
    tone === 'positive' ? c.positiveSoft : tone === 'negative' ? c.negativeSoft : tone === 'warning' ? c.warningSoft : tone === 'accent' ? c.accentSoft : c.surfaceAlt;
  const color = tone === 'muted' ? c.textMuted : c[tone];
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[VARIANTS.caption, { color }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={c.textFaint} />
      <T variant="heading" center>
        {title}
      </T>
      <T tone="muted" center>
        {body}
      </T>
      {action}
    </View>
  );
}

/** A coloured note inside a screen: something to know or to fix. */
export function Notice({ tone, title, body, action }: { tone: 'warning' | 'negative' | 'accent' | 'positive'; title: string; body?: string; action?: ReactNode }) {
  const { c } = useTheme();
  const background = tone === 'warning' ? c.warningSoft : tone === 'negative' ? c.negativeSoft : tone === 'positive' ? c.positiveSoft : c.accentSoft;
  return (
    <View style={[styles.notice, { backgroundColor: background }]}>
      <T variant="label" tone={tone}>
        {title}
      </T>
      {body ? (
        <T variant="label" weight="400">
          {body}
        </T>
      ) : null}
      {action}
    </View>
  );
}

// The focused field is shown by its border; the browser's own outline would double it up.
const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  numeric: { fontVariant: ['tabular-nums'] },
  scrollContent: { paddingBottom: 120 },
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: space.lg, gap: space.md },
  footer: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardPadded: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row' },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  sectionTitle: { marginTop: space.md },
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 34,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 34, borderRadius: radius.md - 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentActive: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  progressTrack: { overflow: 'hidden', alignSelf: 'stretch' },
  field: { gap: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  inputWrapActive: { borderWidth: 1.5 },
  pickerWrap: { paddingVertical: space.sm },
  input: { flex: 1, fontSize: 16, paddingVertical: space.md, minWidth: 0 },
  toggleRow: { minHeight: 48 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  glyph: { alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  notice: { borderRadius: radius.md, padding: space.md, gap: 4 },
});
