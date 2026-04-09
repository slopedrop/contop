import * as SecureStore from 'expo-secure-store';
import {
  savePairingToken,
  getPairingToken,
  clearPairingToken,
  saveGeminiApiKey,
  getGeminiApiKey,
  clearGeminiApiKey,
  hasValidPairingData,
} from './secureStorage';
import { CONTOP_PAIRING_TOKEN, GEMINI_API_KEY_STORAGE_KEY } from '../constants';
import { buildFakePairingPayload } from '../__tests__/factories';

jest.mock('expo-secure-store');

const mockedSecureStore = jest.mocked(SecureStore);

describe('secureStorage service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('savePairingToken', () => {
    test('[P0] should store pairing token as JSON string via expo-secure-store setItemAsync', async () => {
      // Given - a valid pairing payload to persist
      const payload = buildFakePairingPayload();
      mockedSecureStore.setItemAsync.mockResolvedValue(undefined);

      // When - saving the pairing token
      await savePairingToken(payload);

      // Then - the token is stored as a JSON-serialized string under the correct key
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        CONTOP_PAIRING_TOKEN,
        JSON.stringify(payload),
      );
    });

    test('[P0] should store the complete QR payload (all fields preserved)', async () => {
      // Given - a pairing payload with all fields populated
      const payload = buildFakePairingPayload();
      let capturedValue: string | undefined;
      mockedSecureStore.setItemAsync.mockImplementation(async (_key, value) => {
        capturedValue = value;
      });

      // When - saving the pairing token
      await savePairingToken(payload);

      // Then - the stored JSON contains every field from the original payload
      expect(JSON.parse(capturedValue!)).toEqual(payload);
    });
  });

  describe('getPairingToken', () => {
    test('[P0] should retrieve and parse stored token from expo-secure-store getItemAsync', async () => {
      // Given - a previously stored pairing token exists in secure storage
      const storedPayload = buildFakePairingPayload();
      mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(storedPayload));

      // When - retrieving the pairing token
      const result = await getPairingToken();

      // Then - the returned payload matches the originally stored data
      expect(result).toEqual(storedPayload);
    });

    test('[P0] should return null when no token is stored', async () => {
      // Given - secure storage has no pairing token
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      // When - attempting to retrieve the pairing token
      const result = await getPairingToken();

      // Then - null is returned indicating no token exists
      expect(result).toBeNull();
    });

    test('[P0] should return null and delete token when stored token is expired', async () => {
      // Given - a stored pairing token whose expires_at is in the past
      const expiredPayload = buildFakePairingPayload({
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(expiredPayload));
      mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // When - attempting to retrieve the expired pairing token
      const result = await getPairingToken();

      // Then - null is returned because the token has expired
      expect(result).toBeNull();
    });

    test('[P0] should also clear Gemini API key when stored token is expired', async () => {
      // Given - a stored pairing token whose expires_at is in the past
      const expiredPayload = buildFakePairingPayload({
        expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      mockedSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(expiredPayload));
      mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // When - attempting to retrieve the expired pairing token
      await getPairingToken();

      // Then - both pairing token and Gemini API key are cleared
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(CONTOP_PAIRING_TOKEN);
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(GEMINI_API_KEY_STORAGE_KEY);
    });

    test('[P0] should also clear Gemini API key when stored token has corrupt JSON', async () => {
      // Given - corrupt JSON stored as pairing token
      mockedSecureStore.getItemAsync.mockResolvedValue('not-valid-json{{{');
      mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // When - attempting to retrieve the corrupt pairing token
      const result = await getPairingToken();

      // Then - both pairing token and Gemini API key are cleared
      expect(result).toBeNull();
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(CONTOP_PAIRING_TOKEN);
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(GEMINI_API_KEY_STORAGE_KEY);
    });
  });

  describe('clearPairingToken', () => {
    test('[P1] should delete stored token via expo-secure-store deleteItemAsync', async () => {
      // Given - a pairing token may exist in secure storage
      mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // When - clearing the pairing token
      await clearPairingToken();

      // Then - deleteItemAsync is called with the correct storage key
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(CONTOP_PAIRING_TOKEN);
    });
  });
});

describe('Gemini API key storage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('saveGeminiApiKey', () => {
    test('[P0] should store Gemini API key via expo-secure-store setItemAsync', async () => {
      // Given - a Gemini API key to persist
      const apiKey = 'test-gemini-api-key-xyz';
      mockedSecureStore.setItemAsync.mockResolvedValue(undefined);

      // When - saving the Gemini API key
      await saveGeminiApiKey(apiKey);

      // Then - setItemAsync is called with the correct key and value
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
        GEMINI_API_KEY_STORAGE_KEY,
        apiKey,
      );
    });
  });

  describe('getGeminiApiKey', () => {
    test('[P0] should retrieve stored Gemini API key via expo-secure-store getItemAsync', async () => {
      // Given - a Gemini API key stored in secure storage
      const storedKey = 'stored-gemini-key-abc';
      mockedSecureStore.getItemAsync.mockResolvedValue(storedKey);

      // When - retrieving the Gemini API key
      const result = await getGeminiApiKey();

      // Then - getItemAsync is called with the correct storage key and value is returned
      expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith(GEMINI_API_KEY_STORAGE_KEY);
      expect(result).toBe(storedKey);
    });

    test('[P0] should return null when no Gemini API key is stored', async () => {
      // Given - secure storage has no Gemini API key
      mockedSecureStore.getItemAsync.mockResolvedValue(null);

      // When - attempting to retrieve the Gemini API key
      const result = await getGeminiApiKey();

      // Then - null is returned
      expect(result).toBeNull();
    });
  });

  describe('clearGeminiApiKey', () => {
    test('[P1] should delete stored Gemini API key via expo-secure-store deleteItemAsync', async () => {
      // Given - a Gemini API key may exist in secure storage
      mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

      // When - clearing the Gemini API key
      await clearGeminiApiKey();

      // Then - deleteItemAsync is called with the correct storage key
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(GEMINI_API_KEY_STORAGE_KEY);
    });
  });
});

describe('hasValidPairingData (Story 5.1)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('[P0] 5.1-UNIT-004: returns valid:true when both token and Gemini key exist', async () => {
    const payload = buildFakePairingPayload();
    mockedSecureStore.getItemAsync
      .mockResolvedValueOnce(JSON.stringify(payload))  // pairing token
      .mockResolvedValueOnce('gemini-key-123');         // Gemini key

    const result = await hasValidPairingData();
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('[P0] 5.1-UNIT-005: returns valid:false with reason no_token when token is missing', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    const result = await hasValidPairingData();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_token');
  });

  test('[P0] 5.1-UNIT-006: returns valid:false with reason no_credentials when no API keys or subscriptions exist', async () => {
    const payload = buildFakePairingPayload();
    mockedSecureStore.getItemAsync
      .mockResolvedValueOnce(JSON.stringify(payload))  // pairing token exists
      .mockResolvedValueOnce(null);                     // no API keys

    const result = await hasValidPairingData();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_credentials');
  });

  test('[P0] 5.1-UNIT-007: returns valid:false when token is expired', async () => {
    const expired = buildFakePairingPayload({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(expired));

    const result = await hasValidPairingData();
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_token');
  });
});
