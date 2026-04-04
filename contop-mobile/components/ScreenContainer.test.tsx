import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import ScreenContainer from './ScreenContainer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

describe('ScreenContainer', () => {
  it('renders children', () => {
    render(
      <ScreenContainer>
        <Text>Screen content</Text>
      </ScreenContainer>,
    );
    expect(screen.getByText('Screen content')).toBeTruthy();
  });

  it('applies safe area top and bottom padding by default', () => {
    const { toJSON } = render(
      <ScreenContainer>
        <Text>Content</Text>
      </ScreenContainer>,
    );
    const tree = toJSON();
    expect(tree).toBeTruthy();
    // Default edges=['top', 'bottom'] — only requested edges are set,
    // left/right are omitted so className padding is not overridden
    expect(tree.props.style).toEqual({
      paddingTop: 44,
      paddingBottom: 34,
    });
  });

  it('accepts className prop', () => {
    const { toJSON } = render(
      <ScreenContainer className="items-center">
        <Text>Content</Text>
      </ScreenContainer>,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('applies only requested edges', () => {
    const { toJSON } = render(
      <ScreenContainer edges={['top', 'bottom']}>
        <Text>Content</Text>
      </ScreenContainer>,
    );
    const tree = toJSON();
    expect(tree.props.style).toEqual({
      paddingTop: 44,
      paddingBottom: 34,
    });
  });
});
