import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/platform/haptics';

import { Glass, hasLiquidGlass } from './glass';
import { DropIn, KeyboardAvoider, useReducedMotion } from './motion';
import { Button, IconButton, OnBackground, Row, T } from './primitives';
import { continuous, radius, space, useTheme } from './theme';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}

/**
 * A panel that slides up from the bottom, for pickers and short forms.
 *
 * The dim behind it fades in where it is; only the panel travels. On the way
 * out the panel leaves first and the sheet is removed once it has gone.
 */
export function Sheet({ visible, onClose, ...rest }: SheetProps) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));
  // Opening is decided while rendering, so the first frame already contains the sheet.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduced ? 0 : visible ? 280 : 200,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, reduced, progress]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/*
        A modal is its own window. Measuring the safe area again here gives the
        gap for the home indicator, not the one for the tab bar that the screen
        underneath reports.
      */}
      <SafeAreaProvider>
        <SheetPanel visible={visible} onClose={onClose} progress={progress} {...rest} />
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetPanel({ onClose, title, children, footer, testID, progress }: SheetProps & { progress: Animated.Value }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <KeyboardAvoider style={styles.sheetStage} bottomInset={insets.bottom}>
      {/* The dim covers the whole screen and only changes opacity. */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: progress }]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      {/* A sheet floats: inset from the edges, with corners that follow the screen's own. */}
      <Animated.View
        style={[
          styles.sheetDock,
          {
            paddingBottom: Math.max(insets.bottom, space.sm),
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
          },
        ]}
        pointerEvents="box-none"
      >
        <Glass testID={testID} style={[styles.sheet, !hasLiquidGlass && { backgroundColor: c.bg }]}>
          {/* Glass alone lets the screen behind show through the form; this keeps the sheet readable. */}
          {hasLiquidGlass ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, opacity: 0.88 }]} /> : null}
          <View accessibilityViewIsModal style={styles.sheetInner}>
            <View style={[styles.grabber, { backgroundColor: c.textFaint }]} />
            <Row style={styles.sheetHeader}>
              <T variant="heading" style={styles.flex} accessibilityRole="header">
                {title}
              </T>
              <IconButton icon="close" label="Close" onPress={onClose} size={16} />
            </Row>
            <OnBackground>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.sheetBody}>
                {children}
              </ScrollView>
              {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
            </OnBackground>
          </View>
        </Glass>
      </Animated.View>
    </KeyboardAvoider>
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

const FeedbackContext = createContext<{
  confirm: Confirm;
  toast: Toast;
  message: string | null;
}>({
  confirm: async () => false,
  toast: () => undefined,
  message: null,
});

/**
 * Shows the current toast. One sits at the root of the app; on a phone, screens
 * presented as a sheet add their own, because a sheet covers the root.
 */
export function ToastHost({ testID }: { testID?: string }) {
  const insets = useSafeAreaInsets();
  const { message } = useContext(FeedbackContext);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { top: insets.top + space.sm }]}>
      <DropIn key={message}>
        <Glass style={styles.toast}>
          <View accessibilityLiveRegion="polite" accessibilityRole="alert" testID={testID}>
            <T variant="label" weight="600" center>
              {message}
            </T>
          </View>
        </Glass>
      </DropIn>
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
    if (options.destructive) haptic.warn();
    if (Platform.OS !== 'web') {
      return new Promise<boolean>((resolve) => {
        Alert.alert(
          options.title,
          options.message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: options.confirmLabel ?? 'OK',
              style: options.destructive ? 'destructive' : 'default',
              onPress: () => resolve(true),
            },
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
    haptic.success();
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
          <View accessibilityRole="alert" testID="confirm-dialog" style={[styles.dialog, continuous, { backgroundColor: c.surface }]}>
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  sheetStage: { flex: 1, justifyContent: 'flex-end' },
  sheetDock: { maxHeight: '90%', width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: space.sm },
  sheet: { borderRadius: radius.xl, overflow: 'hidden', flexShrink: 1 },
  sheetInner: { flexShrink: 1, paddingBottom: space.lg },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: space.sm,
    opacity: 0.45,
  },
  sheetHeader: {
    paddingLeft: space.xl,
    paddingRight: space.sm,
    paddingTop: space.xs,
    paddingBottom: space.xs,
  },
  sheetBody: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    gap: space.md,
  },
  sheetFooter: { paddingHorizontal: space.lg, paddingTop: space.sm },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
  },
  dialogActions: { marginTop: space.sm },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  toast: {
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    maxWidth: 480,
    overflow: 'hidden',
  },
});
