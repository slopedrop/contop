import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import SplashContent from './SplashContent';

jest.mock('./ContopIcon', () => ({
  __esModule: true,
  default: () => require('react').createElement(require('react-native').View, { testID: 'contop-icon' }),
}));

describe('SplashContent', () => {
  it('renders logo, tagline, and loading bar', () => {
    const { getByTestId } = render(<SplashContent />);

    expect(getByTestId('splash-content')).toBeTruthy();
    expect(getByTestId('splash-logo')).toBeTruthy();
    expect(getByTestId('splash-tagline')).toBeTruthy();
    expect(getByTestId('splash-loading-bar')).toBeTruthy();
  });

  it('displays correct branding text', () => {
    const { getByText } = render(<SplashContent />);

    // ContopIcon replaced the old [>_] text — verify tagline only
    expect(getByText('Remote Compute Agent')).toBeTruthy();
  });
});
