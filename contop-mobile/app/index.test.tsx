import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import HomeScreen from '.';

const mockReplace = jest.fn();
const mockUseRouter = jest.fn().mockReturnValue({
  replace: mockReplace,
  push: jest.fn(),
  back: jest.fn(),
});

jest.mock('expo-router', () => ({
  useRouter: () => mockUseRouter(),
}));

const mockGetPairingToken = jest.fn();
const mockGetGeminiApiKey = jest.fn();

jest.mock('../services/secureStorage', () => ({
  getPairingToken: (...args: unknown[]) => mockGetPairingToken(...args),
  getGeminiApiKey: (...args: unknown[]) => mockGetGeminiApiKey(...args),
}));

describe('HomeScreen (Flow Controller)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGetPairingToken.mockReset();
    mockGetGeminiApiKey.mockReset();
  });

  it('routes to connect screen when no stored token (first launch)', async () => {
    mockGetPairingToken.mockResolvedValue(null);

    render(<HomeScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(connect)/splash',
        params: { next: 'connect' },
      });
    });
  });

  it('routes to connect screen with message when Gemini key is missing', async () => {
    mockGetPairingToken.mockResolvedValue({ token: 'test' });
    mockGetGeminiApiKey.mockResolvedValue(null);

    render(<HomeScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(connect)/splash',
        params: {
          next: 'connect',
          message: 'Gemini API key missing from secure storage. Please pair again.',
        },
      });
    });
  });

  it('routes to reconnecting screen when both token and key are valid', async () => {
    mockGetPairingToken.mockResolvedValue({ token: 'test' });
    mockGetGeminiApiKey.mockResolvedValue('valid-key');

    render(<HomeScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(connect)/splash',
        params: { next: 'reconnecting' },
      });
    });
  });
});
