import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import TailscaleGuide from './TailscaleGuide';

describe('TailscaleGuide', () => {
  it('renders all 5 setup steps when visible', () => {
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`tailscale-step-${i}`)).toBeTruthy();
    }
  });

  it('renders one-time setup header', () => {
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);
    expect(screen.getByTestId('one-time-header')).toBeTruthy();
  });

  it('renders done footer', () => {
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);
    expect(screen.getByTestId('setup-complete-footer')).toBeTruthy();
  });

  it('calls onClose when close button pressed', () => {
    const onClose = jest.fn();
    render(<TailscaleGuide visible={true} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('tailscale-guide-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders App Store and Play Store links', () => {
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);
    expect(screen.getByTestId('tailscale-link-app-store')).toBeTruthy();
    expect(screen.getByTestId('tailscale-link-play-store')).toBeTruthy();
  });

  it('renders desktop download link', () => {
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);
    expect(screen.getByTestId('tailscale-link-tailscale.com/download')).toBeTruthy();
  });

  it('calls Linking.openURL with correct URL when link is pressed', () => {
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);
    render(<TailscaleGuide visible={true} onClose={jest.fn()} />);

    fireEvent.press(screen.getByTestId('tailscale-link-app-store'));
    expect(openURLSpy).toHaveBeenCalledWith('https://apps.apple.com/app/tailscale/id1470499037');

    fireEvent.press(screen.getByTestId('tailscale-link-play-store'));
    expect(openURLSpy).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.tailscale.ipn');

    fireEvent.press(screen.getByTestId('tailscale-link-tailscale.com/download'));
    expect(openURLSpy).toHaveBeenCalledWith('https://tailscale.com/download');

    openURLSpy.mockRestore();
  });
});
