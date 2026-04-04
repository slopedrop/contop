import { renderHook, act } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { useOrientation } from './useOrientation';
import useAIStore from '../stores/useAIStore';

// Capture the listener registered by Dimensions.addEventListener
let dimensionsListener: ((dims: { window: { width: number; height: number } }) => void) | null = null;

const mockRemove = jest.fn();

jest.spyOn(Dimensions, 'addEventListener').mockImplementation((_event, handler) => {
  dimensionsListener = handler as typeof dimensionsListener;
  return { remove: mockRemove };
});

// Mock Dimensions.get to return portrait by default
const mockDimensionsGet = jest.spyOn(Dimensions, 'get').mockReturnValue({
  width: 400,
  height: 800,
  scale: 2,
  fontScale: 1,
} as ReturnType<typeof Dimensions.get>);

describe('useOrientation (Story 5.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dimensionsListener = null;
    useAIStore.getState().resetStore();
    // Default: portrait dimensions
    mockDimensionsGet.mockReturnValue({
      width: 400,
      height: 800,
      scale: 2,
      fontScale: 1,
    } as ReturnType<typeof Dimensions.get>);
  });

  test('[P0] 5.2-UNIT-010: registers Dimensions change listener on mount', () => {
    renderHook(() => useOrientation());
    expect(Dimensions.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  test('[P0] 5.2-UNIT-011: removes listener on unmount', () => {
    const { unmount } = renderHook(() => useOrientation());
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });

  test('[P0] 5.2-UNIT-012: switches to landscape orientation when width > height', () => {
    renderHook(() => useOrientation());

    act(() => {
      dimensionsListener!({ window: { width: 800, height: 400 } });
    });

    const state = useAIStore.getState();
    expect(state.orientation).toBe('landscape');
    expect(state.layoutMode).toBe('side-by-side'); // default preferred landscape
  });

  test('[P0] 5.2-UNIT-013: switches to portrait orientation when height > width', () => {
    // First go landscape
    renderHook(() => useOrientation());
    act(() => {
      dimensionsListener!({ window: { width: 800, height: 400 } });
    });

    // Then go back to portrait
    act(() => {
      dimensionsListener!({ window: { width: 400, height: 800 } });
    });

    const state = useAIStore.getState();
    expect(state.orientation).toBe('portrait');
    expect(state.layoutMode).toBe('split-view'); // default preferred portrait
  });

  test('[P1] 5.2-UNIT-014: uses preferred layout when switching orientation', () => {
    renderHook(() => useOrientation());

    // Set a preferred landscape layout
    useAIStore.getState().setOrientation('landscape');
    useAIStore.getState().setLayoutMode('fullscreen-video');

    // Switch back to portrait then landscape again
    act(() => {
      dimensionsListener!({ window: { width: 400, height: 800 } });
    });
    act(() => {
      dimensionsListener!({ window: { width: 800, height: 400 } });
    });

    // Should restore fullscreen-video preference for landscape
    expect(useAIStore.getState().layoutMode).toBe('fullscreen-video');
  });

  test('[P0] 5.2-UNIT-015: checks initial orientation on mount', () => {
    // Simulate starting in landscape
    mockDimensionsGet.mockReturnValue({
      width: 800,
      height: 400,
      scale: 2,
      fontScale: 1,
    } as ReturnType<typeof Dimensions.get>);

    renderHook(() => useOrientation());

    // Should detect landscape on mount without waiting for a dimension change event
    const state = useAIStore.getState();
    expect(state.orientation).toBe('landscape');
    expect(state.layoutMode).toBe('side-by-side');
  });
});
