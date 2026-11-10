import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/ui/theme';

/**
 * On iPhone and Android the tab bar is the system's own. On iOS 26 and later
 * that means Liquid Glass: it floats over the content, takes its colour from
 * what scrolls beneath it, and shrinks out of the way on scroll.
 *
 * Browsers have no system tab bar; see _layout.web.tsx.
 */
export default function TabsLayout() {
  const { c } = useTheme();
  const content = { backgroundColor: c.bg };
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={c.accent} disableTransparentOnScrollEdge>
      <NativeTabs.Trigger name="index" contentStyle={content}>
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="transactions" contentStyle={content}>
        <NativeTabs.Trigger.Label>Transactions</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="budget" contentStyle={content}>
        <NativeTabs.Trigger.Label>Budget</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.pie', selected: 'chart.pie.fill' }} md="pie_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan" contentStyle={content}>
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="event" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="accounts" contentStyle={content}>
        <NativeTabs.Trigger.Label>Accounts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} md="account_balance_wallet" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
