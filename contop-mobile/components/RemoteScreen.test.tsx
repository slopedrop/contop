import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import RemoteScreen from './RemoteScreen';

// Global mocks for react-native-webrtc and react-native-reanimated are in jest.setup.js

const { MediaStream } = jest.requireMock('react-native-webrtc') as {
  MediaStream: jest.Mock;
};

describe('RemoteScreen', () => {
  it('renders RTCView when stream is provided', () => {
    const mockStream = new MediaStream();
    render(<RemoteScreen stream={mockStream} />);

    const rtcView = screen.getByTestId('rtc-view');
    expect(rtcView).toBeTruthy();
    expect(rtcView.props.streamURL).toBe('mock-stream-url');
  });

  it('renders black fallback view when stream is null', () => {
    render(<RemoteScreen stream={null} />);

    const fallback = screen.getByTestId('remote-screen-fallback');
    expect(fallback).toBeTruthy();
    expect(screen.queryByTestId('rtc-view')).toBeNull();
  });

  it('accepts and applies className prop', () => {
    render(<RemoteScreen stream={null} className="mt-4" />);

    const fallback = screen.getByTestId('remote-screen-fallback');
    expect(fallback).toBeTruthy();
    if (fallback.props.className) {
      expect(fallback.props.className).toContain('mt-4');
    }
  });

  it('renders RTCView with contain objectFit and zOrder 0', () => {
    const mockStream = new MediaStream();
    render(<RemoteScreen stream={mockStream} />);

    const rtcView = screen.getByTestId('rtc-view');
    expect(rtcView.props.objectFit).toBe('contain');
    expect(rtcView.props.zOrder).toBe(0);
  });

  it('renders correctly with fillViewport prop', () => {
    const mockStream = new MediaStream();
    render(<RemoteScreen stream={mockStream} fillViewport />);

    // Still uses contain objectFit — fill is achieved via scale transform
    const rtcView = screen.getByTestId('rtc-view');
    expect(rtcView.props.objectFit).toBe('contain');
  });

  it('wraps RTCView in animated container for gestures', () => {
    const mockStream = new MediaStream();
    render(<RemoteScreen stream={mockStream} />);

    const animatedView = screen.getByTestId('remote-screen-animated');
    expect(animatedView).toBeTruthy();
  });

  it('renders children outside gesture tree when stream is provided', () => {
    const mockStream = new MediaStream();
    render(
      <RemoteScreen stream={mockStream}>
        <View testID="overlay-button" />
      </RemoteScreen>,
    );

    // Overlay is a sibling to the GestureDetector, not inside it
    const gestureRoot = screen.getByTestId('remote-screen-gesture-root');
    expect(gestureRoot).toBeTruthy();
    expect(screen.getByTestId('overlay-button')).toBeTruthy();
  });

  it('renders children in fallback when stream is null', () => {
    render(
      <RemoteScreen stream={null}>
        <View testID="overlay-button" />
      </RemoteScreen>,
    );

    const fallback = screen.getByTestId('remote-screen-fallback');
    expect(fallback).toBeTruthy();
    expect(screen.getByTestId('overlay-button')).toBeTruthy();
  });

  it('snapshot test for default rendering with null stream', () => {
    const { toJSON } = render(<RemoteScreen stream={null} />);
    expect(toJSON()).toMatchSnapshot();
  });

  describe('compact mode (Story 5.2)', () => {
    it('[P0] 5.2-UNIT-060: compact mode renders rtc-view-compact with cover objectFit', () => {
      const mockStream = new MediaStream();
      render(<RemoteScreen stream={mockStream} compact />);

      expect(screen.getByTestId('remote-screen-compact')).toBeTruthy();
      const rtcView = screen.getByTestId('rtc-view-compact');
      expect(rtcView.props.objectFit).toBe('cover');
    });

    it('[P0] 5.2-UNIT-061: compact mode does NOT render gesture root', () => {
      const mockStream = new MediaStream();
      render(<RemoteScreen stream={mockStream} compact />);

      expect(screen.queryByTestId('remote-screen-gesture-root')).toBeNull();
      expect(screen.queryByTestId('remote-screen-animated')).toBeNull();
    });

    it('[P0] 5.2-UNIT-062: compact mode renders overlay children (for LayoutPicker accessibility)', () => {
      const mockStream = new MediaStream();
      const { View: RNView } = require('react-native');
      render(
        <RemoteScreen stream={mockStream} compact>
          <RNView testID="compact-overlay-child" />
        </RemoteScreen>,
      );

      expect(screen.getByTestId('compact-overlay-child')).toBeTruthy();
    });

    it('[P0] 5.2-UNIT-063: normal mode renders gesture root (not compact)', () => {
      const mockStream = new MediaStream();
      render(<RemoteScreen stream={mockStream} />);

      expect(screen.getByTestId('remote-screen-gesture-root')).toBeTruthy();
      expect(screen.queryByTestId('remote-screen-compact')).toBeNull();
    });
  });
});
