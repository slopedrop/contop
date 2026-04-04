import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import useAIStore from '../stores/useAIStore';

/**
 * Detects device orientation via Dimensions.addEventListener and syncs
 * orientation + preferred layout to the Zustand store.
 * Must be called once in the session screen to activate orientation tracking.
 */
export function useOrientation(): void {
  useEffect(() => {
    function handleChange({ window }: { window: { width: number; height: number } }) {
      const isLandscape = window.width > window.height;
      const store = useAIStore.getState();
      if (isLandscape) {
        store.setOrientation('landscape');
        store.setLayoutMode(store.preferredLandscapeLayout);
      } else {
        store.setOrientation('portrait');
        store.setLayoutMode(store.preferredPortraitLayout);
      }
    }

    // Check initial orientation on mount
    const initial = Dimensions.get('window');
    handleChange({ window: initial });

    const subscription = Dimensions.addEventListener('change', handleChange);
    return () => {
      subscription.remove();
    };
  }, []);
}
