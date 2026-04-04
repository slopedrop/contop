// Manual mock for expo-secure-store (ATDD red phase)
// This mock allows test suites to load before the real package is installed.

export const setItemAsync = jest.fn().mockResolvedValue(undefined);
export const getItemAsync = jest.fn().mockResolvedValue(null);
export const deleteItemAsync = jest.fn().mockResolvedValue(undefined);
