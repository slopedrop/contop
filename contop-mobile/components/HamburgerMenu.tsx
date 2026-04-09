import React, { useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from './Text';
import useAIStore from '../stores/useAIStore';
import { LAYOUT_OPTIONS } from '../types';
import type { LayoutMode } from '../types';

type HamburgerMenuProps = {
  onNewSession: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onDisconnect?: () => void;
};

export default function HamburgerMenu({
  onNewSession,
  onHistory,
  onSettings,
  onDisconnect,
}: HamburgerMenuProps): React.JSX.Element {
  const { layoutMode, orientation, setLayoutMode } = useAIStore();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const visibleOptions = LAYOUT_OPTIONS.filter((o) => o.orientation === orientation);

  function handleSelect(mode: LayoutMode) {
    setLayoutMode(mode);
    setOpen(false);
  }

  function handleAction(action: () => void) {
    setOpen(false);
    action();
  }

  const dropdownTop = insets.top + 56;
  const screenHeight = Dimensions.get('window').height;
  const maxDropdownHeight = screenHeight - dropdownTop - insets.bottom - 16;

  return (
    <View testID="hamburger-menu-container">
      {/* Trigger button - 36x36 glassmorphic circle */}
      <Pressable
        testID="hamburger-menu-button"
        onPress={() => setOpen(true)}
        style={styles.triggerButton}
        hitSlop={8}
        accessibilityLabel="Open menu"
        accessibilityRole="button"
      >
        <Ionicons name="menu-outline" size={18} color="#fff" />
      </Pressable>

      {/* Dropdown modal */}
      <Modal
        testID="hamburger-menu-modal"
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Backdrop */}
        <Pressable
          testID="hamburger-menu-backdrop"
          style={StyleSheet.absoluteFillObject}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close menu"
        />

        {/* Dropdown panel */}
        <View
          style={[styles.dropdown, { top: dropdownTop, maxHeight: maxDropdownHeight }]}
          testID="hamburger-menu-dropdown"
          accessibilityRole="menu"
        >
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {/* Layout section */}
            <Text style={styles.sectionLabel} accessibilityRole="header">
              {orientation === 'portrait' ? 'LAYOUT - PORTRAIT' : 'LAYOUT - LANDSCAPE'}
            </Text>
            {visibleOptions.map((opt) => (
              <Pressable
                key={opt.mode}
                testID={`layout-option-${opt.mode}`}
                onPress={() => handleSelect(opt.mode)}
                style={[styles.item, opt.mode === layoutMode && styles.itemActive]}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: opt.mode === layoutMode }}
                accessibilityLabel={opt.label}
              >
                <Ionicons
                  name={opt.icon as keyof typeof Ionicons.glyphMap}
                  size={14}
                  color={opt.mode === layoutMode ? '#095BB9' : '#9CA3AF'}
                />
                <Text style={[styles.itemText, opt.mode === layoutMode && styles.itemTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}

            {/* Session section */}
            <View style={styles.divider} />
            <Text style={styles.sectionLabel} accessibilityRole="header">SESSION</Text>
            <Pressable
              testID="hamburger-new-session"
              onPress={() => handleAction(onNewSession)}
              style={styles.item}
              accessibilityRole="menuitem"
              accessibilityLabel="New Session"
            >
              <Ionicons name="add-outline" size={14} color="#9CA3AF" />
              <Text style={styles.itemText}>New Session</Text>
            </Pressable>
            <Pressable
              testID="hamburger-history"
              onPress={() => handleAction(onHistory)}
              style={styles.item}
              accessibilityRole="menuitem"
              accessibilityLabel="History"
            >
              <Ionicons name="time-outline" size={14} color="#9CA3AF" />
              <Text style={styles.itemText}>History</Text>
            </Pressable>

            {/* Settings + Disconnect */}
            <View style={styles.divider} />
            <Pressable
              testID="hamburger-settings"
              onPress={() => handleAction(onSettings)}
              style={styles.item}
              accessibilityRole="menuitem"
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={14} color="#9CA3AF" />
              <Text style={styles.itemText}>Settings</Text>
            </Pressable>
            {onDisconnect && (
              <Pressable
                testID="hamburger-disconnect"
                onPress={() => handleAction(onDisconnect)}
                style={styles.item}
                accessibilityRole="menuitem"
                accessibilityLabel="Disconnect"
                accessibilityHint="Ends the current session and disconnects"
              >
                <Ionicons name="log-out-outline" size={14} color="#EF4444" />
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            )}
          </ScrollView>
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
    width: 210,
    backgroundColor: '#0A0A0A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    color: '#6B7280',
    marginBottom: 4,
    marginLeft: 8,
    marginTop: 4,
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
    backgroundColor: '#101113',
  },
  itemText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  itemTextActive: {
    color: '#095BB9',
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
