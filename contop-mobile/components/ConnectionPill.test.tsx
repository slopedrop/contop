import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ConnectionPill from './ConnectionPill';

describe('ConnectionPill', () => {
  it('renders with connected status and latency', () => {
    render(<ConnectionPill status="connected" latencyMs={12} />);

    expect(screen.getByTestId('connection-pill')).toBeTruthy();
    expect(screen.getByTestId('connection-dot')).toBeTruthy();
    expect(screen.getByText('12ms')).toBeTruthy();
  });

  it('shows dash for latency when disconnected', () => {
    render(<ConnectionPill status="disconnected" />);

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('sets accessibility label with status and latency', () => {
    render(<ConnectionPill status="connected" latencyMs={42} connectionPath="lan" />);

    const pill = screen.getByTestId('connection-pill');
    expect(pill.props.accessibilityLabel).toBe(
      'Connection status: connected via LAN, latency 42 milliseconds',
    );
  });

  it('shows connection path label when connected', () => {
    render(<ConnectionPill status="connected" latencyMs={12} connectionPath="lan" />);
    expect(screen.getByTestId('connection-path-label')).toBeTruthy();
    expect(screen.getByText('LAN')).toBeTruthy();
  });

  it('shows Tailscale path label', () => {
    render(<ConnectionPill status="connected" latencyMs={50} connectionPath="tailscale" />);
    expect(screen.getByText('Tailscale')).toBeTruthy();
  });

  it('shows Tunnel path label', () => {
    render(<ConnectionPill status="connected" latencyMs={100} connectionPath="tunnel" />);
    expect(screen.getByText('Tunnel')).toBeTruthy();
  });

  it('does not show path label when disconnected', () => {
    render(<ConnectionPill status="disconnected" connectionPath="lan" />);
    expect(screen.queryByTestId('connection-path-label')).toBeNull();
  });
});
