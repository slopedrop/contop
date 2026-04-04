import React, { useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import Text from './Text';
import { expandPayload } from '../services/pairingPayload';
import type { PairingPayload } from '../types';

type QRScannerProps = {
  onScanSuccess: (payload: PairingPayload) => void;
  onScanError: (error: string) => void;
};

const REQUIRED_FIELDS: (keyof PairingPayload)[] = [
  'token',
  'dtls_fingerprint',
  'server_host',
  'server_port',
  'expires_at',
];

export default function QRScanner({ onScanSuccess, onScanError }: QRScannerProps) {
  const scannedRef = useRef(false);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;

      try {
        const raw = JSON.parse(data);
        const payload = expandPayload(raw);

        const missingFields = REQUIRED_FIELDS.filter(
          (f) => !(f in payload) || payload[f] == null || payload[f] === '',
        );
        if (missingFields.length > 0) {
          onScanError(`Invalid QR code: missing ${missingFields.join(', ')}`);
          return;
        }

        scannedRef.current = true;
        onScanSuccess(payload as PairingPayload);
      } catch {
        onScanError('Invalid QR code: not valid JSON');
      }
    },
    [onScanSuccess, onScanError],
  );

  return (
    <View testID="qr-scanner" className="flex-1 bg-space-black">
      <CameraView
        testID="camera-view"
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View className="absolute inset-0" pointerEvents="none">
        <View className="flex-1 bg-space-black/50" />
        <View className="flex-row">
          <View className="flex-1 bg-space-black/50" />
          <View className="w-64 h-64 border-2 border-space-blue rounded-2xl" />
          <View className="flex-1 bg-space-black/50" />
        </View>
        <View className="flex-1 bg-space-black/50 items-center pt-8">
          <Text className="text-white text-lg font-semibold">Scan QR Code</Text>
          <Text className="text-white/60 text-sm mt-2 text-center px-8">
            Point your camera at the QR code on your host machine
          </Text>
        </View>
      </View>
    </View>
  );
}
