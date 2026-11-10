import { router } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';

import { formatMoney } from '@/domain/money';
import { describeRule } from '@/domain/rules';
import { useLookups } from '@/features/shared';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Button, Card, EmptyState, IconButton, Row, Screen, T } from '@/ui/primitives';
import { space, useTheme } from '@/ui/theme';

export default function RulesScreen() {
  const { c } = useTheme();
  const data = useData();
  const lookups = useLookups();
  const store = useStore.getState();
  const base = data.settings.baseCurrency;

  const names = {
    category: (id: string) => lookups.category.get(id)?.name ?? 'a deleted category',
    account: (id: string) => lookups.account.get(id)?.name ?? 'a deleted account',
    money: (minor: number) => formatMoney(minor, base),
  };

  return (
    <Screen edges={['bottom']} testID="rules-screen">
      <T tone="muted">
        Rules tidy up transactions as they arrive. They run from top to bottom and the first one to set a category wins, so put the most specific ones first.
      </T>
      {data.rules.length === 0 ? (
        <Card>
          <EmptyState icon="git-branch-outline" title="No rules yet" body='Create one here, or switch on "Always file under…" when you categorise a transaction.' />
        </Card>
      ) : (
        data.rules.map((rule, index) => {
          const text = describeRule(rule, names);
          return (
            <Card key={rule.id}>
              <Row align="flex-start">
                <View style={styles.flex}>
                  <T variant="caption" tone="faint">
                    WHEN
                  </T>
                  <T testID={`rule-when-${index}`}>{text.when}</T>
                  <T variant="caption" tone="faint" style={styles.then}>
                    THEN
                  </T>
                  <T>{text.then}</T>
                </View>
                <Switch
                  accessibilityLabel={`Rule ${index + 1} enabled`}
                  value={rule.enabled}
                  onValueChange={(enabled) => store.updateRule(rule.id, { enabled })}
                  trackColor={{ true: c.accent, false: c.border }}
                />
              </Row>
              <Row>
                <IconButton icon="arrow-up" label={`Move rule ${index + 1} up`} onPress={() => store.moveRule(rule.id, -1)} disabled={index === 0} filled testID={`rule-up-${index}`} />
                <IconButton
                  icon="arrow-down"
                  label={`Move rule ${index + 1} down`}
                  onPress={() => store.moveRule(rule.id, 1)}
                  disabled={index === data.rules.length - 1}
                  filled
                  testID={`rule-down-${index}`}
                />
                <View style={styles.flex} />
                <Button label="Edit" kind="secondary" small onPress={() => router.push({ pathname: '/rule', params: { id: rule.id } })} testID={`rule-edit-${index}`} />
              </Row>
            </Card>
          );
        })
      )}
      <Button label="New rule" icon="add" onPress={() => router.push('/rule')} testID="add-rule" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  then: { marginTop: space.sm },
});
