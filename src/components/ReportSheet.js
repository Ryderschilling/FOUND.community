import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONT, SPACING, RADIUS, SHADOW } from '../theme';
import { PrimaryButton, GhostButton } from './Atoms';
import { supabase } from '../lib/supabase';
import { useToast } from './ToastProvider';

const REASONS = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'safety', label: 'Safety concern' },
  { id: 'fake', label: 'Fake account' },
  { id: 'other', label: 'Other' },
];

export default function ReportSheet({ visible, targetKind, targetId, onClose, onReported }) {
  const toast = useToast();
  const [selectedReason, setSelectedReason] = useState(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) {
      toast({ title: 'Please select a reason', message: 'Choose a reason before submitting.', type: 'info' });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('report_content', {
        p_target_kind: targetKind,
        p_target_id: targetId,
        p_reason: selectedReason,
        p_details: details.trim() || null,
      });

      if (error) {
        toast({ title: 'Report failed', message: error.message || 'Could not submit report. Try again.', type: 'error' });
        setSubmitting(false);
        return;
      }

      // Show confirmation then close
      toast({ title: 'Report sent', message: 'Thank you. We take safety seriously.', type: 'success' });
      setSubmitting(false);
      setSelectedReason(null);
      setDetails('');
      onReported?.();
      onClose?.();
    } catch (e) {
      console.warn('[report] submission failed', e?.message);
      toast({ title: 'Error', message: e?.message || 'Something went wrong.', type: 'error' });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header row with close X */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Report content</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Reason selection */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>What's wrong?</Text>
              <View style={styles.reasonsList}>
                {REASONS.map((reason) => (
                  <TouchableOpacity
                    key={reason.id}
                    style={[
                      styles.reasonItem,
                      selectedReason === reason.id && styles.reasonItemSelected,
                    ]}
                    onPress={() => setSelectedReason(reason.id)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.reasonRadio,
                        selectedReason === reason.id && styles.reasonRadioSelected,
                      ]}
                    >
                      {selectedReason === reason.id ? (
                        <View style={styles.reasonRadioDot} />
                      ) : null}
                    </View>
                    <Text style={styles.reasonLabel}>{reason.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Optional details */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Additional details (optional)</Text>
              <TextInput
                style={styles.detailsInput}
                placeholder="Tell us more about the issue..."
                placeholderTextColor={COLORS.textTertiary}
                value={details}
                onChangeText={setDetails}
                multiline
                returnKeyType="default"
                editable={!submitting}
                maxLength={500}
              />
              <Text style={styles.charCount}>
                {details.length}/500
              </Text>
            </View>
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.actions}>
            <GhostButton
              label="Cancel"
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label={submitting ? '...' : 'Report'}
              onPress={handleSubmit}
              disabled={submitting || !selectedReason}
              loading={submitting}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },

  sheet: {
    // On web the Modal portals to the document root, outside the phone-width
    // frame in App.js — cap + center it so the bottom sheet stays inside the
    // phone column instead of stretching the whole browser. No-op on native.
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 430 : undefined,
    alignSelf: 'center',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    maxHeight: '85%',
    ...SHADOW.lg,
  },

  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.full,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },

  headerTitle: {
    fontFamily: FONT.serifItalic,
    fontSize: 20,
    color: COLORS.text,
    letterSpacing: -0.2,
  },

  scrollContainer: {
    flex: 1,
    marginBottom: SPACING.lg,
  },

  scrollContent: {
    gap: SPACING.lg,
  },

  section: {
    gap: SPACING.sm,
  },

  sectionLabel: {
    fontFamily: FONT.semiBold,
    fontSize: 14,
    color: COLORS.text,
    letterSpacing: 0.2,
  },

  reasonsList: {
    gap: SPACING.xs,
  },

  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    gap: SPACING.sm,
  },

  reasonItemSelected: {
    backgroundColor: COLORS.bg,
  },

  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: RADIUS.full,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  reasonRadioSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },

  reasonRadioDot: {
    width: 8,
    height: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.white,
  },

  reasonLabel: {
    fontFamily: FONT.regular,
    fontSize: 15,
    color: COLORS.text,
    flex: 1,
  },

  detailsInput: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    fontFamily: FONT.regular,
    fontSize: 14,
    color: COLORS.text,
    textAlignVertical: 'top',
    minHeight: 100,
    maxHeight: 150,
  },

  charCount: {
    fontFamily: FONT.regular,
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
    textAlign: 'right',
  },

  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
});
