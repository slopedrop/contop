import * as LocalAuthentication from 'expo-local-authentication';
import type { BiometricResult } from '../types';

export type { BiometricResult };

const BIOMETRIC_TYPE_MAP: Record<number, string> = {
  [LocalAuthentication.AuthenticationType.FINGERPRINT]: 'fingerprint',
  [LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION]: 'facial',
  [LocalAuthentication.AuthenticationType.IRIS]: 'iris',
};

export async function checkBiometricAvailability(): Promise<BiometricResult> {
  const available = await LocalAuthentication.hasHardwareAsync();
  const enrolled = available ? await LocalAuthentication.isEnrolledAsync() : false;
  const supportedTypes = available
    ? await LocalAuthentication.supportedAuthenticationTypesAsync()
    : [];

  return {
    available,
    enrolled,
    biometricTypes: supportedTypes.map(
      (type) => BIOMETRIC_TYPE_MAP[type] ?? String(type),
    ),
  };
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Authenticate to access Contop',
    fallbackLabel: 'Use passcode',
  });

  return result.success;
}
