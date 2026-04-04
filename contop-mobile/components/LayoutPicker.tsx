import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './Text';
import useAIStore from '../stores/useAIStore';
import { LAYOUT_OPTIONS } from '../types';
import type { LayoutMode } from '../types';

type LayoutPickerProps = {
  className?: string;
  onDisconnect?: () => void;
};

export default function LayoutPicker({ className, onDisconnect }: LayoutPickerProps): React.JSX.Element {
  const { layoutMode, orientation, setLayoutMode } = useAIStore();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const visibleOptions = LAYOUT_OPTIONS.filter((o) => o.orientation === orientation);

  function handleSelect(mode: LayoutMode) {
    setLayoutMode(mode);
    setOpen(false);
  }

  function handleDisconnect() {
    setOpen(false);
    onDisconnect?.();
  }

  return (
    <View testID="layout-picker-container" className={className}>
      {/* Trigger button — 36×36 glassmorphic circle */}
      <Pressable
        testID="layout-picker-button"
        onPress={() => setOpen(true)}
        style={styles.triggerButton}
        hitSlop={8}
      >
        <Ionicons name="grid-outline" size={16} color="#fff" />
      </Pressable>

      {/* Dropdown modal */}
      <Modal
        testID="layout-picker-modal"
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Backdrop — dismiss on outside tap */}
        <Pressable
          testID="layout-picker-backdrop"
          style={StyleSheet.absoluteFillObject}
          onPress={() => setOpen(false)}
        />

        {/* Dropdown panel */}
        <View style={[styles.dropdown, { top: insets.top + 56 }]} testID="layout-picker-dropdown">
          {/* Section label */}
          <Text style={styles.sectionLabel} testID={`layout-section-${orientation}`}>
            {orientation === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE'}
          </Text>

          {visibleOptions.map((opt) => (
            <Pressable
              key={opt.mode}
              testID={`layout-option-${opt.mode}`}
              onPress={() => handleSelect(opt.mode)}
              style={[styles.item, opt.mode === layoutMode && styles.itemActive]}
            >
              <Ionicons
                name={opt.icon as keyof typeof Ionicons.glyphMap}
                size={14}
                color={opt.mode === layoutMode ? '#095BB9' : '#9CA3AF'}
              />
              <Text
                style={[styles.itemText, opt.mode === layoutMode && styles.itemTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}

          {/* Divider + Disconnect */}
          {onDisconnect && (
            <>
              <View style={styles.divider} />
              <Pressable
                testID="layout-picker-disconnect"
                onPress={handleDisconnect}
                style={styles.item}
              >
                <Ionicons name="log-out-outline" size={14} color="#EF4444" />
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  triggerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(16,17,19,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dropdown: {
    position: 'absolute',
    left: 16,
    width: 190,
    backgroundColor: '#0A0A0A', // surface-1
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)', // border-1
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#6B7280', // text-dim
    marginBottom: 4,
    marginLeft: 8,
    letterSpacing: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  itemActive: {
    backgroundColor: '#101113', // surface-2
  },
  itemText: {
    fontSize: 13,
    color: '#9CA3AF', // text-secondary
  },
  itemTextActive: {
    color: '#095BB9', // space-blue accent
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 6,
  },
  disconnectText: {
    fontSize: 13,
    color: '#EF4444',
  },
});
