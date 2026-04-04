import React from 'react';
import { View, Pressable, Modal } from 'react-native';
import Text from './Text';

type ErrorModalProps = {
  visible: boolean;
  attempt: number;
  maxAttempts: number;
  failed: boolean;
  onWait: () => void;
  onDisconnect: () => void;
};

export default function ErrorModal({
  visible,
  attempt,
  maxAttempts,
  failed,
  onWait,
  onDisconnect,
}: ErrorModalProps): React.JSX.Element {
  return (
    <Modal
      testID="error-modal"
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View
        className="flex-1 items-center justify-center bg-black/70"
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <View className="bg-[#0A0A0A] border border-white/10 rounded-2xl mx-8 p-6 items-center w-full max-w-sm">
          {/* Red icon */}
          <View className="w-12 h-12 rounded-full bg-red-500/20 items-center justify-center mb-4">
            <Text className="text-2xl text-red-500">!</Text>
          </View>

          <Text
            testID="error-modal-title"
            className="text-lg font-bold text-white mb-2"
            style={{ fontFamily: 'IBMPlexSans_700Bold' }}
          >
            CONNECTION LOST
          </Text>

          <Text className="text-sm text-gray-400 text-center mb-4">
            {failed
              ? 'All reconnection attempts failed.'
              : 'Attempting to restore your session...'}
          </Text>

          {/* Progress / attempt counter */}
          {!failed && (
            <View className="w-full mb-4">
              <View className="w-full h-1 bg-white/10 rounded-full overflow-hidden mb-2">
                <View
                  testID="reconnect-progress"
                  className="h-full bg-space-blue rounded-full"
                  style={{ width: `${(attempt / maxAttempts) * 100}%` }}
                />
              </View>
              <Text
                testID="attempt-counter"
                className="text-xs text-gray-500 text-center"
              >
                Attempt {attempt} of {maxAttempts}
              </Text>
            </View>
          )}

          {/* Action buttons */}
          <View className="flex-row gap-3 w-full">
            {!failed && (
              <Pressable
                testID="wait-button"
                onPress={onWait}
                className="flex-1 py-3 bg-space-blue rounded-xl items-center"
              >
                <Text className="text-white text-sm font-semibold">
                  Wait for Reconnect
                </Text>
              </Pressable>
            )}
            <Pressable
              testID="disconnect-now-button"
              onPress={onDisconnect}
              className={`${failed ? 'flex-1' : ''} py-3 px-4 bg-white/10 rounded-xl items-center`}
            >
              <Text className="text-gray-300 text-sm font-medium">
                Disconnect Now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
