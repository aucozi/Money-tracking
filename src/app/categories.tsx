import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CategoryGroup, CategoryKind } from '@/domain/types';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { Sheet, useConfirm, useToast } from '@/ui/overlays';
import { Button, Card, Field, Glyph, ListItem, Pill, Row, Screen, SectionTitle, Segmented, T } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function CategoriesScreen() {
  const data = useData();
  const store = useStore.getState();
  const confirm = useConfirm();
  const toast = useToast();
  const [editingGroup, setEditingGroup] = useState<CategoryGroup | 'new' | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupKind, setGroupKind] = useState<CategoryKind>('expense');

  const openGroup = (group: CategoryGroup | 'new') => {
    setGroupName(group === 'new' ? '' : group.name);
    setGroupKind(group === 'new' ? 'expense' : group.kind);
    setEditingGroup(group);
  };

  const saveGroup = () => {
    if (!groupName.trim() || !editingGroup) return;
    if (editingGroup === 'new') store.addGroup(groupName, groupKind);
    else store.updateGroup(editingGroup.id, { name: groupName.trim() });
    setEditingGroup(null);
    toast('Group saved');
  };

  const removeGroup = async (group: CategoryGroup) => {
    const ok = await confirm({ title: `Delete the group ${group.name}?`, confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    store.deleteGroup(group.id);
    setEditingGroup(null);
  };

  return (
    <Screen edges={['bottom']} testID="categories-screen">
      <T tone="muted">Groups keep related categories together in the budget. Archive a category you no longer use to keep its history.</T>
      {[...data.categoryGroups]
        .sort((a, b) => a.sort - b.sort)
        .map((group) => {
          const categories = data.categories.filter((category) => category.groupId === group.id).sort((a, b) => a.sort - b.sort);
          return (
            <View key={group.id} style={styles.group}>
              <SectionTitle action={<Button label="Rename" kind="ghost" small onPress={() => openGroup(group)} testID={`rename-${group.id}`} />}>
                {group.name}
                {group.kind === 'income' ? '  ·  income' : ''}
              </SectionTitle>
              <Card padded={false}>
                {categories.map((category) => (
                  <ListItem
                    key={category.id}
                    title={category.name}
                    leading={<Glyph icon={category.icon} color={category.color} />}
                    trailing={
                      <Row gap={6}>
                        {category.rollover ? <Pill label="Carries over" tone="accent" /> : null}
                        {category.archived ? <Pill label="Archived" /> : null}
                      </Row>
                    }
                    onPress={() => router.push({ pathname: '/category', params: { id: category.id } })}
                    testID={`category-${category.id}`}
                  />
                ))}
                <ListItem
                  title="Add a category"
                  leading={<Glyph icon="➕" />}
                  onPress={() => router.push({ pathname: '/category', params: { groupId: group.id } })}
                  testID={`add-category-${group.id}`}
                />
              </Card>
            </View>
          );
        })}
      <Button label="New group" kind="secondary" icon="add" onPress={() => openGroup('new')} testID="add-group" />

      <Sheet
        visible={editingGroup !== null}
        onClose={() => setEditingGroup(null)}
        title={editingGroup === 'new' ? 'New group' : 'Rename group'}
        footer={<Button label="Save" onPress={saveGroup} disabled={!groupName.trim()} testID="save-group" />}>
        <Field label="Name" value={groupName} onChangeText={setGroupName} autoFocus autoCapitalize="words" testID="group-name" />
        {editingGroup === 'new' ? (
          <Segmented
            value={groupKind}
            onChange={setGroupKind}
            options={[
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
            ]}
          />
        ) : editingGroup && !data.categories.some((category) => category.groupId === editingGroup.id) ? (
          <Button label="Delete this empty group" kind="danger" onPress={() => removeGroup(editingGroup)} />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: space.md } });
