/**
 * Module-level bridge for passing temp pairing payloads between screens.
 *
 * Expo Router's useLocalSearchParams doesn't reliably pass large JSON
 * objects via route params. This bridge stores the payload in memory
 * and allows the reconnecting screen to consume it once.
 */
import type { PairingPayload } from '../types';

let _tempPayload: PairingPayload | null = null;

/** Store a temp payload for the reconnecting screen to pick up. */
export function setTempPayload(payload: PairingPayload): void {
  _tempPayload = payload;
}

/** Retrieve and clear the stored temp payload (one-time read). */
export function consumeTempPayload(): PairingPayload | null {
  const payload = _tempPayload;
  _tempPayload = null;
  return payload;
}
