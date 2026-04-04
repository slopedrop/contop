import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import LayoutPicker from './LayoutPicker';
import useAIStore from '../stores/useAIStore';

jest.mock('../stores/useAIStore');

const mockSetLayoutMode = jest.fn();

function mockStoreWith(layoutMode: string, orientation: string) {
  (useAIStore as unknown as jest.Mock).mockReturnValue({
    layoutMode,
    orientation,
    setLayoutMode: mockSetLayoutMode,
  });
}

describe('LayoutPicker (Story 5.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreWith('split-view', 'portrait');
  });

  test('[P0] 5.2-UNIT-030: renders trigger button', () => {
    render(<LayoutPicker />);
    expect(screen.getByTestId('layout-picker-button')).toBeTruthy();
  });

  test('[P0] 5.2-UNIT-031: shows 3 portrait options when orientation is portrait', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));

    expect(screen.getByTestId('layout-option-video-focus')).toBeTruthy();
    expect(screen.getByTestId('layout-option-split-view')).toBeTruthy();
    expect(screen.getByTestId('layout-option-thread-focus')).toBeTruthy();
    expect(screen.queryByTestId('layout-option-side-by-side')).toBeNull();
    expect(screen.queryByTestId('layout-option-fullscreen-video')).toBeNull();
  });

  test('[P0] 5.2-UNIT-032: shows 2 landscape options when orientation is landscape', () => {
    mockStoreWith('side-by-side', 'landscape');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));

    expect(screen.getByTestId('layout-option-side-by-side')).toBeTruthy();
    expect(screen.getByTestId('layout-option-fullscreen-video')).toBeTruthy();
    expect(screen.queryByTestId('layout-option-video-focus')).toBeNull();
    expect(screen.queryByTestId('layout-option-split-view')).toBeNull();
    expect(screen.queryByTestId('layout-option-thread-focus')).toBeNull();
  });

  test('[P0] 5.2-UNIT-033: calls setLayoutMode when a layout option is selected', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));
    fireEvent.press(screen.getByTestId('layout-option-video-focus'));

    expect(mockSetLayoutMode).toHaveBeenCalledWith('video-focus');
  });

  test('[P0] 5.2-UNIT-034: dropdown dismisses after selecting a layout', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));
    expect(screen.getByTestId('layout-picker-dropdown')).toBeTruthy();

    fireEvent.press(screen.getByTestId('layout-option-thread-focus'));

    // After selection, modal closes (dropdown no longer visible)
    expect(screen.queryByTestId('layout-picker-dropdown')).toBeNull();
  });

  test('[P1] 5.2-UNIT-035: backdrop tap dismisses the dropdown', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));
    expect(screen.getByTestId('layout-picker-dropdown')).toBeTruthy();

    fireEvent.press(screen.getByTestId('layout-picker-backdrop'));
    expect(screen.queryByTestId('layout-picker-dropdown')).toBeNull();
  });

  test('[P1] 5.2-UNIT-036: active layout item has accent styling', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));

    // Active item (split-view) should have itemActive style applied
    const activeItem = screen.getByTestId('layout-option-split-view');
    const flatStyle = Array.isArray(activeItem.props.style)
      ? Object.assign({}, ...activeItem.props.style.filter(Boolean))
      : activeItem.props.style;
    expect(flatStyle.backgroundColor).toBe('#101113'); // surface-2 active bg
  });

  test('[P1] 5.2-UNIT-037: disconnect button shown when onDisconnect provided', () => {
    const mockDisconnect = jest.fn();
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker onDisconnect={mockDisconnect} />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));
    const disconnectBtn = screen.getByTestId('layout-picker-disconnect');
    expect(disconnectBtn).toBeTruthy();

    fireEvent.press(disconnectBtn);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  test('[P1] 5.2-UNIT-038: disconnect button NOT shown when onDisconnect not provided', () => {
    mockStoreWith('split-view', 'portrait');
    render(<LayoutPicker />);

    fireEvent.press(screen.getByTestId('layout-picker-button'));
    expect(screen.queryByTestId('layout-picker-disconnect')).toBeNull();
  });
});
