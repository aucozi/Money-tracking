import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView } from 'expo-symbols';
import { type ComponentProps } from 'react';
import { Platform } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * On iPhone, icons are SF Symbols, so they match the system in weight and
 * optical size. Everything else uses the equivalent Ionicon.
 */
const SF: Partial<Record<IconName, SFSymbol>> = {
  add: 'plus',
  'arrow-down': 'arrow.down',
  'arrow-up': 'arrow.up',
  calendar: 'calendar',
  'calendar-outline': 'calendar',
  checkmark: 'checkmark',
  'checkmark-circle': 'checkmark.circle.fill',
  'checkmark-circle-outline': 'checkmark.circle',
  'chevron-back': 'chevron.left',
  'chevron-down': 'chevron.down',
  'chevron-forward': 'chevron.right',
  close: 'xmark',
  'close-circle-outline': 'xmark.circle',
  'document-outline': 'doc',
  'download-outline': 'square.and.arrow.down',
  'ellipse-outline': 'circle',
  'flag-outline': 'flag',
  'git-branch-outline': 'arrow.triangle.branch',
  'globe-outline': 'globe',
  'happy-outline': 'face.smiling',
  home: 'house.fill',
  'home-outline': 'house',
  'link-outline': 'link',
  list: 'list.bullet',
  'list-outline': 'list.bullet',
  'lock-closed-outline': 'lock',
  navigate: 'location.fill',
  'open-outline': 'arrow.up.right.square',
  'options-outline': 'slider.horizontal.3',
  'pie-chart': 'chart.pie.fill',
  'pie-chart-outline': 'chart.pie',
  'pricetags-outline': 'tag',
  'receipt-outline': 'doc.text',
  refresh: 'arrow.clockwise',
  'search-outline': 'magnifyingglass',
  'settings-outline': 'gearshape',
  'share-outline': 'square.and.arrow.up',
  'trash-outline': 'trash',
  'trending-up-outline': 'chart.line.uptrend.xyaxis',
  wallet: 'creditcard.fill',
  'wallet-outline': 'creditcard',
};

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  const symbol = Platform.OS === 'ios' ? SF[name] : undefined;
  if (symbol) {
    return (
      <SymbolView
        name={symbol}
        size={size}
        tintColor={color}
        weight="medium"
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
        fallback={<Ionicons name={name} size={size} color={color} />}
      />
    );
  }
  return <Ionicons name={name} size={size} color={color} />;
}
