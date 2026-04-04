import { faker } from '@faker-js/faker';
import type { PairingPayload } from '../types';

export function buildFakePairingPayload(
  overrides?: Partial<PairingPayload>,
): PairingPayload {
  const hexOctets = Array.from({ length: 32 }, () =>
    faker.string.hexadecimal({ length: 2, casing: 'upper', prefix: false }),
  );

  return {
    token: faker.string.uuid(),
    dtls_fingerprint: hexOctets.join(':'),
    gemini_api_key: 'test-gemini-api-key',
    stun_config: {
      ice_servers: [
        {
          urls: `stun:${faker.internet.domainName()}:${faker.number.int({ min: 1024, max: 65535 })}`,
        },
      ],
    },
    server_host: faker.internet.ipv4(),
    server_port: faker.number.int({ min: 1024, max: 65535 }),
    expires_at: faker.date.future().toISOString(),
    ...overrides,
  };
}
