import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, Row, T } from './primitives';
import { radius, space, useTheme } from './theme';

/** A panel that slides up from the bottom, for pickers and short forms. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable accessibilityLabel="Close" style={[styles.fill, { backgroundColor: c.overlay }]} onPress={onClose} />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <Row style={styles.sheetHeader}>
            <T variant="heading" style={styles.flex} accessibilityRole="header">
              {title}
            </T>
            <IconButton icon="close" label="Close" onPress={onClose} filled />
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
type Toast = (message: string) => void;

const FeedbackContext = createContext<{ confirm: Confirm; toast: Toast }>({
  confirm: async () => false,
  toast: () => undefined,
});

/** Ask before anything that cannot be undone. Resolves true only on an explicit yes. */
export function useConfirm(): Confirm {
  return useContext(FeedbackContext).confirm;
}

/** Briefly confirm that something happened. */
export function useToast(): Toast {
  return useContext(FeedbackContext).toast;
}

/**
 * Confirmation dialogs and toasts. Built here rather than on the system alert
 * so they look and behave the same on iPhone, Android and the web.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    resolver.current?.(false);
    setDialog(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setDialog(null);
  };

  const toast = useCallback<Toast>((text) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => answer(false)} statusBarTranslucent>
        <View style={[styles.fill, styles.centered, { backgroundColor: c.overlay }]}>
          <View accessibilityRole="alert" testID="confirm-dialog" style={[styles.dialog, { backgroundColor: c.surface }]}>
            <T variant="heading">{dialog?.title}</T>
            {dialog?.message ? <T tone="muted">{dialog.message}</T> : null}
            <Row style={styles.dialogActions}>
              <Button label="Cancel" kind="secondary" onPress={() => answer(false)} style={styles.flex} />
              <Button
                label={dialog?.confirmLabel ?? 'OK'}
                kind={dialog?.destructive ? 'danger' : 'primary'}
                onPress={() => answer(true)}
                style={styles.flex}
                testID="confirm-yes"
              />
            </Row>
          </View>
        </View>
      </Modal>
      {message ? (
        <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 96 }]}>
          <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID="toast" style={[styles.toast, { backgroundColor: c.text }]}>
            <T variant="label" style={{ color: c.bg }} center>
              {message}
            </T>
          </View>
        </View>
      ) : null}
    </FeedbackContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  sheetHeader: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  sheetBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  sheetFooter: { paddingHorizontal: space.lg, paddingTop: space.sm },
  dialog: { width: '100%', maxWidth: 400, borderRadius: radius.lg, padding: space.xl, gap: space.md },
  dialogActions: { marginTop: space.sm },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.xl },
  toast: { borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.md, maxWidth: 480 },
});
