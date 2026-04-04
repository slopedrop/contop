import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ErrorModal from './ErrorModal';

describe('ErrorModal', () => {
  const defaultProps = {
    visible: true,
    attempt: 2,
    maxAttempts: 3,
    failed: false,
    onWait: jest.fn(),
    onDisconnect: jest.fn(),
  };

  it('renders title, attempt counter, and both buttons when reconnecting', () => {
    render(<ErrorModal {...defaultProps} />);

    expect(screen.getByText('CONNECTION LOST')).toBeTruthy();
    expect(screen.getByText('Attempt 2 of 3')).toBeTruthy();
    expect(screen.getByText('Wait for Reconnect')).toBeTruthy();
    expect(screen.getByText('Disconnect Now')).toBeTruthy();
  });

  it('hides Wait button and progress when failed', () => {
    render(<ErrorModal {...defaultProps} failed={true} />);

    expect(screen.getByText('All reconnection attempts failed.')).toBeTruthy();
    expect(screen.queryByText('Wait for Reconnect')).toBeNull();
    expect(screen.queryByTestId('attempt-counter')).toBeNull();
  });

  it('calls onWait when Wait button pressed', () => {
    const onWait = jest.fn();
    render(<ErrorModal {...defaultProps} onWait={onWait} />);

    fireEvent.press(screen.getByTestId('wait-button'));
    expect(onWait).toHaveBeenCalledTimes(1);
  });

  it('calls onDisconnect when Disconnect button pressed', () => {
    const onDisconnect = jest.fn();
    render(<ErrorModal {...defaultProps} onDisconnect={onDisconnect} />);

    fireEvent.press(screen.getByTestId('disconnect-now-button'));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
