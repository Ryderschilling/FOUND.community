// ─────────────────────────────────────────────────────────────────────────
// ErrorBoundary.js
//
// Top-level safety net. In a RELEASE React Native build, any unhandled error
// thrown during render is escalated to a native SIGABRT (RCTFatal) — the whole
// app hard-crashes with no message. This boundary catches those, reports them
// to Sentry, and shows a recoverable screen instead of killing the process.
//
// Intentionally dependency-free (no theme / no design system imports) so the
// fallback can never itself throw — even if the crash was caused by one of
// those modules failing to load.
// ─────────────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

let Sentry = null;
try {
  // Lazy + guarded: if Sentry isn't installed/initialized, we still render.
  Sentry = require('../lib/sentry').Sentry;
} catch (e) {
  Sentry = null;
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Always log to console so it shows in `npx expo start --no-dev` / device logs.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info?.componentStack);
    try {
      if (Sentry?.captureException) {
        Sentry.captureException(error, {
          extra: { componentStack: info?.componentStack },
        });
      }
    } catch (e) {
      /* never let reporting crash the fallback */
    }
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message =
      this.state.error?.message ?? String(this.state.error ?? 'Unknown error');

    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error. You can try again — if it keeps
          happening, please let us know.
        </Text>

        {__DEV__ ? (
          <Text style={styles.debug} numberOfLines={8}>
            {message}
          </Text>
        ) : null}

        <TouchableOpacity style={styles.btn} onPress={this.handleReset} activeOpacity={0.85}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: '#F7F4EF',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5A5A52',
    textAlign: 'center',
    marginBottom: 22,
  },
  debug: {
    fontSize: 12,
    color: '#B23A3A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    marginBottom: 22,
  },
  btn: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
