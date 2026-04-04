import React from 'react';
import { Modal, ScrollView, Pressable, View, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './Text';

type TailscaleGuideProps = {
  visible: boolean;
  onClose: () => void;
};

const STEPS = [
  {
    number: 1,
    icon: 'phone-portrait-outline' as const,
    title: 'Install Tailscale on your phone',
    description: 'Download from the App Store or Play Store.',
    links: [
      { label: 'App Store', url: 'https://apps.apple.com/app/tailscale/id1470499037' },
      { label: 'Play Store', url: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn' },
    ],
  },
  {
    number: 2,
    icon: 'desktop-outline' as const,
    title: 'Install Tailscale on your desktop',
    description: 'Download from the Tailscale website.',
    links: [{ label: 'tailscale.com/download', url: 'https://tailscale.com/download' }],
  },
  {
    number: 3,
    icon: 'person-outline' as const,
    title: 'Sign in with the same account',
    description: 'Use the same email or SSO on both devices so they join the same network.',
    links: [],
  },
  {
    number: 4,
    icon: 'refresh-outline' as const,
    title: 'Restart the Contop server',
    description: 'It will automatically detect your Tailscale address.',
    links: [],
  },
  {
    number: 5,
    icon: 'qr-code-outline' as const,
    title: 'Re-scan the QR code',
    description: 'The new code will include your Tailscale address.',
    links: [],
  },
];

export default function TailscaleGuide({ visible, onClose }: TailscaleGuideProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/80 justify-end">
        <View className="bg-[#0A0A0A] rounded-t-2xl border-t border-white/10 max-h-[85%]">
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-white/6">
            <Text className="text-lg font-bold text-white">Tailscale Setup</Text>
            <Pressable
              testID="tailscale-guide-close"
              onPress={onClose}
              accessibilityLabel="Close setup guide"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color="#9CA3AF" />
            </Pressable>
          </View>

          <ScrollView className="px-5 py-4" contentContainerStyle={{ paddingBottom: 32 }}>
            {/* One-time setup messaging */}
            <View className="bg-space-blue/10 rounded-xl p-4 mb-6 border border-space-blue/20">
              <Text testID="one-time-header" className="text-base font-semibold text-white mb-1">
                One-time setup
              </Text>
              <Text className="text-sm text-gray-400">
                After this initial setup, Contop will automatically connect through Tailscale
                whenever you're away from home. No more re-scanning QR codes.
              </Text>
            </View>

            {/* Steps */}
            {STEPS.map((step) => (
              <View key={step.number} testID={`tailscale-step-${step.number}`} className="flex-row mb-5">
                <View className="w-8 h-8 rounded-full bg-white/10 items-center justify-center mr-3 mt-0.5">
                  <Text className="text-sm font-bold text-white">{step.number}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base font-medium text-white mb-1">{step.title}</Text>
                  <Text className="text-sm text-gray-400 mb-2">{step.description}</Text>
                  {step.links.length > 0 && (
                    <View className="flex-row flex-wrap gap-2">
                      {step.links.map((link) => (
                        <Pressable
                          key={link.url}
                          testID={`tailscale-link-${link.label.toLowerCase().replace(/\s/g, '-')}`}
                          onPress={() => void Linking.openURL(link.url)}
                          className="bg-white/10 rounded-lg px-3 py-1.5"
                        >
                          <Text className="text-xs text-space-blue font-medium">{link.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))}

            {/* Footer */}
            <View className="bg-green-500/10 rounded-xl p-4 mt-2 border border-green-500/20">
              <Text testID="setup-complete-footer" className="text-sm text-green-400 font-medium">
                Done! Future connections will work from anywhere.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
