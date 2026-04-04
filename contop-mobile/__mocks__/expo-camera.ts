// Manual mock for expo-camera (ATDD red phase)
// This mock allows test suites to load before the real package is installed.

export const CameraView = 'CameraView';
export const Camera = {
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
};
