type DataChannelSender = (type: string, payload: Record<string, unknown>) => void;

let _sender: DataChannelSender | null = null;

export function registerDeviceControlSender(fn: DataChannelSender | null): void {
  _sender = fn;
}

export function sendDeviceControl(
  action: 'lock_screen' | 'keep_awake_on' | 'keep_awake_off',
): boolean {
  if (!_sender) return false;
  _sender('device_control', { action });
  return true;
}

export function sendAwayModeEngage(): boolean {
  if (!_sender) return false;
  _sender('away_mode_engage', {});
  return true;
}

export function sendAwayModeDisengage(): boolean {
  if (!_sender) return false;
  _sender('away_mode_disengage', {});
  return true;
}

export function sendAwayModeStatus(): boolean {
  if (!_sender) return false;
  _sender('away_mode_status', {});
  return true;
}

export function sendRefreshProxyStatus(): boolean {
  if (!_sender) return false;
  _sender('refresh_proxy_status', {});
  return true;
}
