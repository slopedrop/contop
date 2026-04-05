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

jest.mock('../services/secureStorage', () => ({
  getPairingToken: (...args: unknown[]) => mockGetPairingToken(...args),
}));

describe('HomeScreen (Flow Controller)', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockGetPairingToken.mockReset();
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

  it('routes to reconnecting screen when token exists', async () => {
    mockGetPairingToken.mockResolvedValue({ token: 'test' });

    render(<HomeScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(connect)/splash',
        params: { next: 'reconnecting' },
      });
    });
  });
});
