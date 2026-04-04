import * as LocalAuthentication from 'expo-local-authentication';
import {
  checkBiometricAvailability,
  authenticateWithBiometrics,
  BiometricResult,
} from './biometrics';

jest.mock('expo-local-authentication');

const mockedLocalAuthentication = jest.mocked(LocalAuthentication);

describe('biometrics service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('checkBiometricAvailability', () => {
    test('[P0] should return available=true, enrolled=true when biometric hardware exists and is enrolled', async () => {
      // Given — device has biometric hardware and user has enrolled biometrics
      mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuthentication.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
      ]);

      // When — checking biometric availability
      const result: BiometricResult = await checkBiometricAvailability();

      // Then — result indicates biometrics are available and enrolled
      expect(result).toEqual({
        available: true,
        enrolled: true,
        biometricTypes: expect.arrayContaining([expect.any(String)]),
      });
    });

    test('[P1] should return available=false when no hardware present', async () => {
      // Given — device lacks biometric hardware
      mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(false);
      mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuthentication.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      // When — checking biometric availability
      const result: BiometricResult = await checkBiometricAvailability();

      // Then — result indicates biometrics are not available
      expect(result.available).toBe(false);
    });

    test('[P1] should return enrolled=false when hardware exists but no biometrics enrolled', async () => {
      // Given — device has biometric hardware but user has not enrolled any biometrics
      mockedLocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuthentication.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuthentication.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      // When — checking biometric availability
      const result: BiometricResult = await checkBiometricAvailability();

      // Then — result indicates biometrics are not enrolled
      expect(result.enrolled).toBe(false);
    });
  });

  describe('authenticateWithBiometrics', () => {
    test('[P0] should call authenticateAsync and return true on success', async () => {
      // Given — biometric authentication will succeed
      mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
        success: true,
        error: undefined as unknown as string,
        warning: undefined as unknown as string,
      });

      // When — authenticating with biometrics
      const result: boolean = await authenticateWithBiometrics();

      // Then — authentication succeeds and returns true
      expect(result).toBe(true);
    });

    test('[P0] should return false when authentication fails', async () => {
      // Given — biometric authentication will fail (e.g., fingerprint not recognized)
      mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'not_enrolled',
        warning: undefined as unknown as string,
      });

      // When — authenticating with biometrics
      const result: boolean = await authenticateWithBiometrics();

      // Then — authentication fails and returns false
      expect(result).toBe(false);
    });

    test('[P1] should return false when user cancels biometric prompt', async () => {
      // Given — user dismisses the biometric prompt
      mockedLocalAuthentication.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'user_cancel',
        warning: undefined as unknown as string,
      });

      // When — authenticating with biometrics
      const result: boolean = await authenticateWithBiometrics();

      // Then — returns false indicating cancelled authentication
      expect(result).toBe(false);
    });
  });
});
