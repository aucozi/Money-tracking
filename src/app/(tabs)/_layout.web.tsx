import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/ui/glass';
import { Icon, type IconName } from '@/ui/icon';
import { space, useTheme } from '@/ui/theme';

const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'transactions', title: 'Transactions', icon: 'list-outline', active: 'list' },
  { name: 'budget', title: 'Budget', icon: 'pie-chart-outline', active: 'pie-chart' },
  { name: 'plan', title: 'Plan', icon: 'calendar-outline', active: 'calendar' },
  { name: 'accounts', title: 'Accounts', icon: 'wallet-outline', active: 'wallet' },
];

/**
 * The web has no system tab bar, so this draws one in the same spirit as the
 * iPhone's: a capsule that floats above the content and blurs what is behind it.
 */
function FloatingTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    // Installed on a home screen the page reaches the bottom edge, so keep clear of the home indicator.
    <View pointerEvents="box-none" style={[styles.dock, { bottom: space.md + insets.bottom }]}>
      <Glass style={styles.bar}>
        <View accessibilityRole="tablist" style={styles.items}>
          {state.routes.map((route, index) => {
            const tab = TABS.find((item) => item.name === route.name);
            if (!tab) return null;
            const focused = state.index === index;
            const color = focused ? c.accent : c.textMuted;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={tab.title}
                accessibilityState={{ selected: focused }}
                testID={`tab-${tab.name}`}
                onPress={() => {
                  const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !event.defaultPrevented) navigateToTab(route.key);
                }}
                style={[styles.item, focused && { backgroundColor: c.accentSoft }]}
              >
                <Icon name={focused ? tab.active : tab.icon} size={22} color={color} />
                <Text numberOfLines={1} style={[styles.label, { color }]}>
                  {tab.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md },
  // Items are 52 tall with a radius of 26; four of padding keeps the bar concentric with them.
  bar: { borderRadius: 30, padding: 4, width: '100%', maxWidth: 440, overflow: 'hidden' },
  items: { flexDirection: 'row' },
  item: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10, fontWeight: '600', letterSpacing: 0.1 },
});
