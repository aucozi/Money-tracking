import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';

import type { IconName } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'transactions', title: 'Transactions', icon: 'list-outline', active: 'list' },
  { name: 'budget', title: 'Budget', icon: 'pie-chart-outline', active: 'pie-chart' },
  { name: 'plan', title: 'Plan', icon: 'calendar-outline', active: 'calendar' },
  { name: 'accounts', title: 'Accounts', icon: 'wallet-outline', active: 'wallet' },
];

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        sceneStyle: { backgroundColor: c.bg },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarButtonTestID: `tab-${tab.name}`,
            tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? tab.active : tab.icon} size={size} color={String(color)} />,
          }}
        />
      ))}
    </Tabs>
  );
}
