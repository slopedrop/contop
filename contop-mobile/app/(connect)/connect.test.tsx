import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ConnectScreen from './connect';

// --- Mocks ---

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-camera', () => ({
  Camera: { requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }) },
}));

jest.mock('../../services/biometrics', () => ({
  checkBiometricAvailability: jest.fn().mockResolvedValue({ available: true, enrolled: true }),
  authenticateWithBiometrics: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/secureStorage', () => ({
  savePairingToken: jest.fn().mockResolvedValue(undefined),
  saveGeminiApiKey: jest.fn().mockResolvedValue(undefined),
  clearPairingToken: jest.fn().mockResolvedValue(undefined),
  getPairingToken: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../components/QRScanner', () => 'QRScanner');

jest.mock('../../components', () => ({
  ScreenContainer: ({ children }: { children: React.ReactNode }) =>
    require('react').createElement(require('react-native').View, { testID: 'screen-container' }, children),
  Text: ({ children, testID, ...props }: any) =>
    require('react').createElement(require('react-native').Text, { testID, ...props }, children),
  ContopIcon: () =>
    require('react').createElement(require('react-native').View, { testID: 'contop-icon' }),
}));

describe('ConnectScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT render a connection method badge (AC-17)', () => {
    render(<ConnectScreen />);
    expect(screen.queryByTestId('connection-method-badge')).toBeNull();
  });

});
