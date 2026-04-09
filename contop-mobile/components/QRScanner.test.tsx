import { render } from '@testing-library/react-native';
import { faker } from '@faker-js/faker';
import QRScanner from './QRScanner';
import { buildFakePairingPayload } from '../__tests__/factories';

jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
}));

describe('QRScanner', () => {
  describe('barcode scanning', () => {
    test('[P0] should call onScanSuccess with parsed payload when valid QR code is scanned', () => {
      // Given -- a valid pairing payload encoded as a QR code
      const validPayload = buildFakePairingPayload();
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      // When -- the camera detects and scans a barcode containing valid JSON
      const cameraView = getByTestId('camera-view');
      const onBarcodeScanned = cameraView.props.onBarcodeScanned;
      onBarcodeScanned({ data: JSON.stringify(validPayload) });

      // Then -- onScanSuccess is called with the parsed payload
      expect(onScanSuccess).toHaveBeenCalledWith(validPayload);
    });

    test('[P1] should call onScanError when QR code contains invalid JSON', () => {
      // Given -- a QR code containing malformed JSON
      const invalidJson = faker.string.alpha(50);
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      // When -- the camera scans a barcode with invalid JSON data
      const cameraView = getByTestId('camera-view');
      const onBarcodeScanned = cameraView.props.onBarcodeScanned;
      onBarcodeScanned({ data: invalidJson });

      // Then -- onScanError is called with an error message
      expect(onScanError).toHaveBeenCalledWith(expect.stringContaining('Invalid'));
    });

    test('[P1] should call onScanError when QR code is missing required fields (token, dtls_fingerprint)', () => {
      // Given -- a QR code with valid JSON but missing required fields
      const incompletePayload = {
        server_host: faker.internet.ipv4(),
        server_port: faker.number.int({ min: 1024, max: 65535 }),
      };
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      // When -- the camera scans a barcode missing token and dtls_fingerprint
      const cameraView = getByTestId('camera-view');
      const onBarcodeScanned = cameraView.props.onBarcodeScanned;
      onBarcodeScanned({ data: JSON.stringify(incompletePayload) });

      // Then -- onScanError is called indicating missing required fields
      expect(onScanError).toHaveBeenCalledWith(expect.stringContaining('missing'));
    });

    test('[P0] should call onScanSuccess when QR code has no API keys (key validation in connect screen)', () => {
      // Given -- a QR code with all structural fields but no API keys
      const payloadWithoutApiKeys = {
        token: faker.string.uuid(),
        dtls_fingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
        stun_config: { ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }] },
        server_host: faker.internet.ipv4(),
        server_port: 8000,
        expires_at: faker.date.future().toISOString(),
        // No API keys - QRScanner validates structural fields only
      };
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      // When -- the camera scans a barcode with no API keys
      const cameraView = getByTestId('camera-view');
      const onBarcodeScanned = cameraView.props.onBarcodeScanned;
      onBarcodeScanned({ data: JSON.stringify(payloadWithoutApiKeys) });

      // Then -- onScanSuccess is called (API key check is in connect.tsx, not QRScanner)
      expect(onScanSuccess).toHaveBeenCalledWith(expect.objectContaining({ token: payloadWithoutApiKeys.token }));
      expect(onScanError).not.toHaveBeenCalled();
    });
  });

  describe('duplicate scan prevention', () => {
    test('[P2] should prevent duplicate scans after successful scan', () => {
      // Given -- a valid payload scanned once already
      const validPayload = buildFakePairingPayload();
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      const cameraView = getByTestId('camera-view');
      const onBarcodeScanned = cameraView.props.onBarcodeScanned;

      // When -- the same barcode is scanned a second time
      onBarcodeScanned({ data: JSON.stringify(validPayload) });
      onBarcodeScanned({ data: JSON.stringify(validPayload) });

      // Then -- onScanSuccess is called exactly once (duplicate is ignored)
      expect(onScanSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('rendering', () => {
    test('[P0] should render camera view component', () => {
      // Given -- the QRScanner component is mounted
      const onScanSuccess = jest.fn();
      const onScanError = jest.fn();

      // When -- the component renders
      const { getByTestId } = render(
        <QRScanner onScanSuccess={onScanSuccess} onScanError={onScanError} />
      );

      // Then -- a CameraView element is present in the tree
      expect(getByTestId('camera-view')).toBeTruthy();
    });
  });
});
