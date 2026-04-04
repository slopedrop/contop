import { faker } from '@faker-js/faker';

type PairingToken = {
  token: string;
  dtls_fingerprint: string;
  gemini_api_key: string;
  stun_config: {
    ice_servers: Array<{ urls: string }>;
  };
  server_host: string;
  server_port: number;
  expires_at: string;
};

export const createPairingToken = (
  overrides: Partial<PairingToken> = {},
): PairingToken => {
  const hexOctets = Array.from({ length: 32 }, () =>
    faker.string.hexadecimal({ length: 2, casing: 'upper', prefix: false }),
  );

  return {
    token: faker.string.uuid(),
    dtls_fingerprint: hexOctets.join(':'),
    gemini_api_key: 'mock-gemini-api-key',
    stun_config: {
      ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }],
    },
    server_host: faker.internet.ip(),
    server_port: 8000,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
};
