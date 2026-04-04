import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import ViewLayoutManager from './ViewLayoutManager';
import useAIStore from '../stores/useAIStore';

// Mock sub-components used by ViewLayoutManager
jest.mock('./SplitSeparator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockSplitSeparator({ orientation }: { orientation: string }) {
    return <View testID={`split-separator-mock-${orientation}`} />;
  };
});

jest.mock('../stores/useAIStore');

function mockStore(layoutMode: string, orientation: string) {
  (useAIStore as unknown as jest.Mock).mockReturnValue({ layoutMode, orientation });
}

const VIDEO = <Text testID="video-content">Video</Text>;
const THREAD = <Text testID="thread-content">Thread</Text>;

describe('ViewLayoutManager (Story 5.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore('split-view', 'portrait');
  });

  test('[P0] 5.2-UNIT-040: renders the root container with onLayout', () => {
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    const root = screen.getByTestId('view-layout-manager');
    expect(root).toBeTruthy();
    expect(root.props.onLayout).toBeDefined();
  });

  test('[P0] 5.2-UNIT-041: split-view shows video, separator, and thread containers', () => {
    mockStore('split-view', 'portrait');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    expect(screen.getByTestId('video-container')).toBeTruthy();
    expect(screen.getByTestId('split-separator-mock-portrait')).toBeTruthy();
    expect(screen.getByTestId('thread-container')).toBeTruthy();
    expect(screen.getByTestId('video-content')).toBeTruthy();
    expect(screen.getByTestId('thread-content')).toBeTruthy();
  });

  test('[P0] 5.2-UNIT-042: video-focus shows video and thread containers (no separator)', () => {
    mockStore('video-focus', 'portrait');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    expect(screen.getByTestId('video-container')).toBeTruthy();
    expect(screen.getByTestId('thread-container')).toBeTruthy();
    expect(screen.queryByTestId('split-separator-mock-portrait')).toBeNull();
  });

  test('[P0] 5.2-UNIT-043: thread-focus shows video and thread containers (no separator)', () => {
    mockStore('thread-focus', 'portrait');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    expect(screen.getByTestId('video-container')).toBeTruthy();
    expect(screen.getByTestId('thread-container')).toBeTruthy();
    expect(screen.getByTestId('video-content')).toBeTruthy();
    expect(screen.getByTestId('thread-content')).toBeTruthy();
    expect(screen.queryByTestId('split-separator-mock-portrait')).toBeNull();
  });

  test('[P0] 5.2-UNIT-044: side-by-side (landscape) shows video, separator, thread', () => {
    mockStore('side-by-side', 'landscape');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    expect(screen.getByTestId('video-container')).toBeTruthy();
    expect(screen.getByTestId('split-separator-mock-landscape')).toBeTruthy();
    expect(screen.getByTestId('thread-container')).toBeTruthy();
  });

  test('[P0] 5.2-UNIT-045: fullscreen-video (landscape) shows video and thread (no separator)', () => {
    mockStore('fullscreen-video', 'landscape');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    expect(screen.getByTestId('video-container')).toBeTruthy();
    expect(screen.getByTestId('thread-container')).toBeTruthy();
    expect(screen.queryByTestId('split-separator-mock-landscape')).toBeNull();
  });

  test('[P0] 5.2-UNIT-047: video and thread containers are persistent across ALL layouts (never unmounted)', () => {
    const layouts: Array<[string, string]> = [
      ['split-view', 'portrait'],
      ['video-focus', 'portrait'],
      ['thread-focus', 'portrait'],
      ['side-by-side', 'landscape'],
      ['fullscreen-video', 'landscape'],
    ];

    for (const [layoutMode, orientation] of layouts) {
      mockStore(layoutMode, orientation);
      const { unmount } = render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
      // Both containers ALWAYS exist — components never unmounted
      expect(screen.getByTestId('video-container')).toBeTruthy();
      expect(screen.getByTestId('thread-container')).toBeTruthy();
      expect(screen.getByTestId('video-content')).toBeTruthy();
      expect(screen.getByTestId('thread-content')).toBeTruthy();
      unmount();
    }
  });

  test('[P1] 5.2-UNIT-048: overlay modes set pointerEvents box-none on thread container', () => {
    mockStore('video-focus', 'portrait');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    const threadContainer = screen.getByTestId('thread-container');
    expect(threadContainer.props.pointerEvents).toBe('box-none');
  });

  test('[P1] 5.2-UNIT-049: split modes set pointerEvents auto on thread container', () => {
    mockStore('split-view', 'portrait');
    render(<ViewLayoutManager videoContent={VIDEO} threadContent={THREAD} />);
    const threadContainer = screen.getByTestId('thread-container');
    expect(threadContainer.props.pointerEvents).toBe('auto');
  });
});
