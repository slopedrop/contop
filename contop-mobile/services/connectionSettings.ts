import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RemoteAccessMethod } from '../types';

const CONNECTION_SETTINGS_KEY = '@contop:connection_settings';

export type ConnectionSettings = {
  remoteAccess: RemoteAccessMethod;
};

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  remoteAccess: 'cloudflare',
};

const VALID_REMOTE_ACCESS: readonly RemoteAccessMethod[] = ['tailscale', 'cloudflare', 'none'];

export async function loadConnectionSettings(): Promise<ConnectionSettings> {
  const raw = await AsyncStorage.getItem(CONNECTION_SETTINGS_KEY);
  if (!raw) return DEFAULT_CONNECTION_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    const remoteAccess = VALID_REMOTE_ACCESS.includes(parsed.remoteAccess)
      ? parsed.remoteAccess
      : DEFAULT_CONNECTION_SETTINGS.remoteAccess;
    return { ...DEFAULT_CONNECTION_SETTINGS, ...parsed, remoteAccess };
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

export async function saveConnectionSettings(
  settings: Partial<ConnectionSettings>,
): Promise<void> {
  const current = await loadConnectionSettings();
  await AsyncStorage.setItem(
    CONNECTION_SETTINGS_KEY,
    JSON.stringify({ ...current, ...settings }),
  );
}
