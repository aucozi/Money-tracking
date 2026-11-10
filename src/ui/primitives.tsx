import { Children, createContext, isValidElement, useContext, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
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
import { haptic } from '@/platform/haptics';

import { Glass, hasLiquidGlass } from './glass';
import { Icon, type IconName } from './icon';
import { continuous, radius, roundedFont, space, useTheme, WEB_TAB_BAR_SPACE, type Palette } from './theme';

export type { IconName };

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
type Tone = 'text' | 'muted' | 'faint' | 'accent' | 'positive' | 'negative' | 'warning' | 'onAccent';

// Apple's type scale: large title, title, headline, body, subheadline, footnote.
const VARIANTS: Record<Variant, TextStyle> = {
  display: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: -0.2,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.1,
  },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
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
        numeric && roundedFont,
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
      {formatMoney(amount, currency, {
        sign: colored ? 'always' : 'auto',
        ...options,
      })}
    </T>
  );
}

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  footer,
  testID,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
  footer?: ReactNode;
  testID?: string;
  /** When given, pulling down calls this. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: c.bg }]} testID={testID}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.textMuted} /> : undefined}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.column]}>{children}</View>
      )}
      {footer ? (
        <View style={styles.footerDock}>
          <Glass style={styles.footer}>{footer}</Glass>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** True inside a card, where inputs need a darker fill to stand out from the card itself. */
const InCard = createContext(false);

/** The fill for an input: one step away from whatever it sits on. */
function useWellColor(): string {
  const { c } = useTheme();
  return useContext(InCard) ? c.surfaceAlt : c.surface;
}

/**
 * A block of content. With `padded={false}` it holds rows, and draws the
 * hairline between them, starting where the row's text starts.
 */
export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { c } = useTheme();
  const rows = padded ? null : Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, continuous, { backgroundColor: c.surface }, padded && styles.cardPadded, style]}>
      <InCard.Provider value>
        {rows
          ? rows.map((row, index) => {
              const hasLeading = isValidElement<{ leading?: ReactNode }>(row) && Boolean(row.props.leading);
              return (
                <View key={isValidElement(row) && row.key !== null ? row.key : index}>
                  {index > 0 ? (
                    <View
                      style={[
                        styles.separator,
                        {
                          backgroundColor: c.border,
                          marginLeft: hasLeading ? 68 : space.lg,
                        },
                      ]}
                    />
                  ) : null}
                  {row}
                </View>
              );
            })
          : children}
      </InCard.Provider>
    </View>
  );
}

/** Marks content as sitting on the plain background again, e.g. a sheet opened from inside a card. */
export function OnBackground({ children }: { children: ReactNode }) {
  return <InCard.Provider value={false}>{children}</InCard.Provider>;
}

export function Row({
  children,
  style,
  gap = space.md,
  align = 'center',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  gap?: number;
  align?: ViewStyle['alignItems'];
}) {
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
      <T style={[styles.flex, styles.sectionText]} accessibilityRole="header">
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
  // One filled, coloured button per screen for the main action; the rest are quieter.
  const background = kind === 'primary' ? c.accent : kind === 'danger' ? c.negativeSoft : kind === 'secondary' ? c.accentSoft : 'transparent';
  const color = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.negative : c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        if (kind === 'primary') haptic.tap();
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: background,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 15 : 18} color={color} /> : null}
      <Text numberOfLines={1} style={[small ? styles.buttonLabelSmall : styles.buttonLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'text',
  filled,
  size = 20,
  disabled,
  testID,
}: {
  icon: IconName;
  /** Read out by screen readers; every icon-only button needs one. */
  label: string;
  onPress: () => void;
  tone?: Tone;
  /** Draw the button on its own round glass surface, as toolbar buttons are. */
  filled?: boolean;
  size?: number;
  disabled?: boolean;
  testID?: string;
}) {
  const { c } = useTheme();
  const glyph = <Icon name={icon} size={size} color={toneColor(c, tone)} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      testID={testID}
      // Real glass must stay fully opaque to render, so it shows presses itself.
      style={({ pressed }) => [
        styles.iconButton,
        {
          opacity: disabled ? 0.35 : pressed && !(filled && hasLiquidGlass) ? 0.55 : 1,
        },
      ]}
    >
      {filled ? (
        <Glass interactive style={styles.iconButtonGlass}>
          {glyph}
        </Glass>
      ) : (
        glyph
      )}
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
      onPress={() => {
        haptic.select();
        onPress?.();
      }}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? c.accent : c.surface,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={[VARIANTS.label, styles.medium, { color }]}>{label}</Text>
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
  const { c, dark } = useTheme();
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
            onPress={() => {
              if (!active) haptic.select();
              onChange(option.value);
            }}
            style={[styles.segment, active && { backgroundColor: dark ? '#636366' : c.surface }, active && styles.segmentActive]}
          >
            <Text numberOfLines={1} style={[VARIANTS.label, active ? styles.semibold : styles.medium, { color: active ? c.text : c.textMuted }]}>
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
      style={[styles.progressTrack, { backgroundColor: c.surfaceAlt, height, borderRadius: height / 2 }]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color ?? c.accent,
        }}
      />
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
  const well = useWellColor();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <T variant="label" tone="muted">
        {label}
      </T>
      <View
        style={[
          styles.inputWrap,
          continuous,
          {
            backgroundColor: well,
            borderColor: error ? c.negative : focused ? c.accent : 'transparent',
          },
        ]}
      >
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
  const well = useWellColor();
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
        style={({ pressed }) => [
          styles.inputWrap,
          styles.pickerWrap,
          continuous,
          {
            backgroundColor: well,
            borderColor: 'transparent',
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        {leading}
        <T style={styles.flex} tone={value ? 'text' : 'faint'} numberOfLines={1}>
          {value || placeholder || 'Choose'}
        </T>
        <Icon name="chevron-down" size={15} color={c.textFaint} />
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
        onValueChange={(next) => {
          haptic.select();
          onChange(next);
        }}
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
      style={({ pressed }) => [
        styles.listItem,
        (pressed || selected) && {
          backgroundColor: selected ? c.accentSoft : c.surfaceAlt,
        },
      ]}
    >
      {content}
    </Pressable>
  );
}

/** A round badge holding a category's emoji. */
export function Glyph({ icon, color, size = 40 }: { icon: string; color?: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.glyph,
        continuous,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: color ? `${color}26` : c.surfaceAlt,
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.5 }}>{icon}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'positive' | 'negative' | 'warning' | 'accent' }) {
  const { c } = useTheme();
  const background =
    tone === 'positive'
      ? c.positiveSoft
      : tone === 'negative'
        ? c.negativeSoft
        : tone === 'warning'
          ? c.warningSoft
          : tone === 'accent'
            ? c.accentSoft
            : c.surfaceAlt;
  const color = tone === 'muted' ? c.textMuted : c[tone];
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[VARIANTS.caption, styles.medium, { color }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={40} color={c.textFaint} />
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
export function Notice({
  tone,
  title,
  body,
  action,
}: {
  tone: 'warning' | 'negative' | 'accent' | 'positive';
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const { c } = useTheme();
  const background = tone === 'warning' ? c.warningSoft : tone === 'negative' ? c.negativeSoft : tone === 'positive' ? c.positiveSoft : c.accentSoft;
  return (
    <View style={[styles.notice, continuous, { backgroundColor: background }]}>
      <T variant="label" tone={tone} weight="600">
        {title}
      </T>
      {body ? <T variant="label">{body}</T> : null}
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
  medium: { fontWeight: '500' },
  semibold: { fontWeight: '600' },
  // Room for the floating add button, and on the web for the app-drawn tab bar.
  scrollContent: { paddingBottom: 120 + WEB_TAB_BAR_SPACE },
  column: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  footerDock: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  // The buttons inside are capsules of height 50; 8 of padding makes this dock concentric with them.
  footer: { padding: space.sm, borderRadius: 33, overflow: 'hidden' },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  cardPadded: { padding: space.lg, gap: space.md },
  separator: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row' },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  sectionTitle: { marginTop: space.md, paddingHorizontal: space.xs },
  sectionText: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: space.lg },
  buttonLabel: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  buttonLabelSmall: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: radius.pill,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentActive: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  progressTrack: { overflow: 'hidden', alignSelf: 'stretch' },
  field: { gap: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  pickerWrap: { paddingVertical: space.sm },
  input: {
    flex: 1,
    fontSize: 17,
    paddingVertical: space.md,
    minWidth: 0,
    letterSpacing: -0.2,
  },
  toggleRow: { minHeight: 50 },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 62,
  },
  glyph: { alignItems: 'center', justifyContent: 'center' },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  notice: { borderRadius: 18, padding: 14, gap: 4 },
});
