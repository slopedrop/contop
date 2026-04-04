// Manual mock for expo-local-authentication (ATDD red phase)
// This mock allows test suites to load before the real package is installed.

export enum AuthenticationType {
  FINGERPRINT = 1,
  FACIAL_RECOGNITION = 2,
  IRIS = 3,
}

export const hasHardwareAsync = jest.fn().mockResolvedValue(false);
export const isEnrolledAsync = jest.fn().mockResolvedValue(false);
export const supportedAuthenticationTypesAsync = jest.fn().mockResolvedValue([]);
export const authenticateAsync = jest.fn().mockResolvedValue({
  success: false,
  error: 'not_available',
  warning: '',
});
