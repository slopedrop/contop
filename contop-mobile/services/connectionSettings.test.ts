import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadConnectionSettings,
  saveConnectionSettings,
  DEFAULT_CONNECTION_SETTINGS,
} from './connectionSettings';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('connectionSettings service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
  });

  test('loadConnectionSettings returns defaults when no stored value', async () => {
    const settings = await loadConnectionSettings();
    expect(settings).toEqual(DEFAULT_CONNECTION_SETTINGS);
    expect(settings.remoteAccess).toBe('cloudflare');
  });

  test('saveConnectionSettings calls setItem with merged settings', async () => {
    await saveConnectionSettings({ remoteAccess: 'tailscale' });
    expect(mockSetItem).toHaveBeenCalledWith(
      '@contop:connection_settings',
      JSON.stringify({ remoteAccess: 'tailscale' }),
    );
  });

  test('saveConnectionSettings merges with existing stored settings', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ remoteAccess: 'none' }));
    await saveConnectionSettings({ remoteAccess: 'tailscale' });
    expect(mockSetItem).toHaveBeenCalledWith(
      '@contop:connection_settings',
      JSON.stringify({ remoteAccess: 'tailscale' }),
    );
  });

  test('loadConnectionSettings retrieves saved value', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ remoteAccess: 'none' }));
    const settings = await loadConnectionSettings();
    expect(settings.remoteAccess).toBe('none');
  });

  test('loadConnectionSettings handles corrupted JSON gracefully', async () => {
    mockGetItem.mockResolvedValue('not-json');
    const settings = await loadConnectionSettings();
    expect(settings).toEqual(DEFAULT_CONNECTION_SETTINGS);
  });
});
