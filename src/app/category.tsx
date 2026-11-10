import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CATEGORY_COLORS } from '@/domain/seed';
import { useData } from '@/store/hooks';
import { useStore } from '@/store/store';
import { closeScreen, ModalScreen } from '@/ui/nav';
import { useConfirm, useToast } from '@/ui/overlays';
import { FormActions, OptionField } from '@/ui/pickers';
import { Field, Notice, Row, T, ToggleRow } from '@/ui/primitives';
import { useTheme } from '@/ui/theme';

export default function CategoryScreen() {
  const params = useLocalSearchParams<{ id?: string; groupId?: string }>();
  const { c } = useTheme();
  const data = useData();
  const confirm = useConfirm();
  const toast = useToast();
  const store = useStore.getState();
  const existing = params.id ? data.categories.find((category) => category.id === params.id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? '🏷️');
  const [groupId, setGroupId] = useState(existing?.groupId ?? params.groupId ?? data.categoryGroups[0]?.id);
  const [color, setColor] = useState(existing?.color ?? CATEGORY_COLORS[data.categories.length % CATEGORY_COLORS.length]);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [attempted, setAttempted] = useState(false);
  const used = existing ? data.transactions.filter((tx) => tx.categoryId === existing.id || tx.splits?.some((split) => split.categoryId === existing.id)).length : 0;
  const nameError = name.trim() ? null : 'Give the category a name.';

  const save = () => {
    setAttempted(true);
    if (nameError || !groupId) return;
    if (existing) store.updateCategory(existing.id, { name: name.trim(), icon: icon.trim() || '🏷️', color, archived, groupId });
    else store.addCategory({ name, icon: icon.trim(), groupId, color });
    toast(existing ? 'Category saved' : 'Category added');
    closeScreen();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      message:
        used > 0
          ? `${used} ${used === 1 ? 'transaction becomes' : 'transactions become'} uncategorized, and its budget and any rules that only set this category are removed. Archive it instead to keep the history.`
          : 'Its budget and any rules that only set this category are removed too.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    store.deleteCategory(existing.id);
    toast('Category deleted');
    closeScreen();
  };

  if (params.id && !existing) {
    return (
      <ModalScreen title="Category">
        <Notice tone="warning" title="This category no longer exists" />
      </ModalScreen>
    );
  }

  return (
    <ModalScreen
      title={existing ? 'Edit category' : 'New category'}
      testID="category-screen"
      footer={<FormActions onSave={save} onDelete={existing ? remove : undefined} saveLabel={existing ? 'Save' : 'Add category'} />}>
      <Row align="flex-start">
        <View style={{ width: 84 }}>
          <Field label="Icon" value={icon} onChangeText={setIcon} maxLength={4} testID="category-icon" />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pets"
            autoCapitalize="words"
            autoFocus={!existing}
            error={attempted ? nameError : null}
            testID="category-name"
          />
        </View>
      </Row>
      <OptionField
        label="Group"
        value={groupId}
        onChange={setGroupId}
        options={[...data.categoryGroups].sort((a, b) => a.sort - b.sort).map((group) => ({ value: group.id, label: group.name, hint: group.kind === 'income' ? 'Income' : undefined }))}
        testID="category-group"
      />
      <T variant="label" tone="muted">
        Colour
      </T>
      <Row style={styles.colors} gap={10}>
        {CATEGORY_COLORS.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={`Colour ${option}`}
            accessibilityState={{ selected: option === color }}
            onPress={() => setColor(option)}
            style={[styles.swatch, { backgroundColor: option, borderColor: option === color ? c.text : 'transparent' }]}
          />
        ))}
      </Row>
      {existing ? (
        <ToggleRow
          label="Archived"
          hint={`Hidden when choosing a category. ${used} ${used === 1 ? 'transaction uses' : 'transactions use'} it and will keep it.`}
          value={archived}
          onChange={setArchived}
          testID="category-archived"
        />
      ) : null}
    </ModalScreen>
  );
}

const styles = StyleSheet.create({
  colors: { flexWrap: 'wrap' },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
});
