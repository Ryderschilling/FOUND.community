// ─────────────────────────────────────────────────────────────────────────
// ConfirmProvider — single in-app confirmation dialog for the whole app.
//
// Why this exists:
//   - React Native Web ignores the `buttons` array passed to Alert.alert,
//     so destructive confirms (sign out, leave group, disconnect…) silently
//     do nothing on the web build.
//   - The old workaround was a per-file `confirmThen` helper that fell back to
//     window.confirm() on web — an ugly native browser dialog, duplicated
//     across 7 files, impossible to style.
//
// This replaces both with one Promise-based API:
//
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: 'Sign out?',
//     message: 'You can sign back in anytime.',
//     confirmLabel: 'Sign out',
//     destructive: true,
//   });
//   if (ok) doSignOut();
//
// Works identically on web and native — it's a plain RN <Modal>, no
// Alert.alert, no window.confirm.
// ─────────────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';

const ConfirmContext = createContext(null);

// App hardcodes this red for destructive UI (no red in the theme palette).
const DESTRUCTIVE = '#D24A4A';

const DEFAULTS = {
  title:        'Are you sure?',
  message:      '',
  confirmLabel: 'Confirm',
  cancelLabel:  'Cancel',
  destructive:  false,
};

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm() must be used inside <ConfirmProvider>');
  }
  return ctx.confirm;
}

export function ConfirmProvider({ children }) {
  const [options, setOptions] = useState(null); // null = closed
  const resolverRef = useRef(null);

  // Returns a Promise<boolean>. Resolves true on confirm, false on cancel /
  // backdrop tap / hardware back.
  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      // If a dialog is somehow already open, resolve it false first so we
      // never leak a dangling promise.
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setOptions({ ...DEFAULTS, ...opts });
    });
  }, []);

  const close = useCallback((result) => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(result);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {/* Rendered after {children} so it always sits on top of every screen,
          sheet, and modal — including the group-settings panel that triggers it.
          Using a plain absolutely-positioned View (not <Modal>) avoids the
          React Native Web portal stacking problem where two <Modal>s compete
          for z-order and the first one wins. */}
      {!!options && (
        <View style={styles.overlay} pointerEvents="box-none">
          {/* Full-screen tap-outside-to-cancel */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => close(false)}
          />

          <View style={styles.dialog}>
            <Text style={styles.title}>{options.title}</Text>
            {options.message ? (
              <Text style={styles.message}>{options.message}</Text>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel]}
                onPress={() => close(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.btnCancelText}>{options.cancelLabel}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.btn,
                  options.destructive ? styles.btnDestructive : styles.btnConfirm,
                ]}
                onPress={() => close(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.btnConfirmText}>{options.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ConfirmContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    // Must beat every other z-index in the app so confirm dialogs
    // are never obscured by sheets, settings panels, or other modals.
    zIndex: 9999,
    elevation: 99, // Android stacking
  },
  dialog: {
    width: '100%',
    // Cap width on web so it doesn't stretch the full browser viewport.
    maxWidth: Platform.OS === 'web' ? 360 : 400,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.lg,
  },
  title: {
    fontFamily: FONT.serifItalic,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  message: {
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginTop: SPACING.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: SPACING.lg,
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnCancelText: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  btnConfirm: {
    backgroundColor: COLORS.accent,
  },
  btnDestructive: {
    backgroundColor: DESTRUCTIVE,
  },
  btnConfirmText: {
    fontFamily: FONT.bold,
    fontSize: 14,
    color: COLORS.white,
    letterSpacing: 0.2,
  },
});
