// Manual mock for expo-router (ATDD red phase)

export const useRouter = jest.fn().mockReturnValue({
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
});

export const useLocalSearchParams = jest.fn().mockReturnValue({});

export const Redirect = jest.fn().mockReturnValue(null);

export const useFocusEffect = jest.fn((callback: () => void | (() => void)) => {
  // In tests, immediately invoke the callback to simulate focus
  const cleanup = callback();
  // Return cleanup if provided (matches React Navigation behavior)
  return cleanup;
});
