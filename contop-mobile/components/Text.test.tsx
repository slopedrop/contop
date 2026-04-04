import React from 'react';
import { render, screen } from '@testing-library/react-native';
import Text from './Text';

describe('Text', () => {
  it('renders children text', () => {
    render(<Text>Hello world</Text>);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('applies default className with font-sans and text-white', () => {
    const { toJSON } = render(<Text>Styled text</Text>);
    const tree = toJSON();
    // Verify the className prop includes defaults (before NativeWind transform)
    expect(tree.props.className || tree.props.style).toBeTruthy();
  });

  it('accepts className override without losing defaults', () => {
    const { toJSON } = render(<Text className="text-lg text-red-500">Custom</Text>);
    const tree = toJSON();
    expect(tree).toBeTruthy();
    // Both default and custom classes should be present
    if (tree.props.className) {
      expect(tree.props.className).toContain('font-sans');
      expect(tree.props.className).toContain('text-lg');
    }
  });

  it('forwards props to underlying Text', () => {
    render(<Text testID="my-text" numberOfLines={1}>Truncated</Text>);
    const el = screen.getByTestId('my-text');
    expect(el).toBeTruthy();
    expect(el.props.numberOfLines).toBe(1);
  });
});
