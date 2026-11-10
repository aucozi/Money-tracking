import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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

const FeedbackContext = createContext<{ confirm: Confirm; toast: Toast; message: string | null }>({
  confirm: async () => false,
  toast: () => undefined,
  message: null,
});

/**
 * Shows the current toast. One sits at the root of the app; on a phone, screens
 * presented as a sheet add their own, because a sheet covers the root.
 */
export function ToastHost({ testID }: { testID?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { message } = useContext(FeedbackContext);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 96 }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID={testID} style={[styles.toast, { backgroundColor: c.text }]}>
        <T variant="label" style={{ color: c.bg }} center>
          {message}
        </T>
      </View>
    </View>
  );
}

/** Ask before anything that cannot be undone. Resolves true only on an explicit yes. */
export function useConfirm(): Confirm {
  return useContext(FeedbackContext).confirm;
}

/** Briefly confirm that something happened. */
export function useToast(): Toast {
  return useContext(FeedbackContext).toast;
}

/**
 * Confirmation dialogs and toasts. On a phone, confirmations use the system
 * alert, which is what people expect there and always appears above whatever
 * sheet is open. Browsers have no equivalent, so the web gets a dialog drawn here.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    if (Platform.OS !== 'web') {
      return new Promise<boolean>((resolve) => {
        Alert.alert(
          options.title,
          options.message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: options.confirmLabel ?? 'OK', style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
    }
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
    <FeedbackContext.Provider value={{ confirm, toast, message }}>
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
      <ToastHost testID="toast" />
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
