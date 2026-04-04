import React from 'react';
import { render, screen } from '@testing-library/react-native';
import SplitSeparator from './SplitSeparator';

describe('SplitSeparator (Story 5.2)', () => {
  const noop = jest.fn();

  test('[P0] 5.2-UNIT-020: renders horizontal pill in portrait orientation', () => {
    render(<SplitSeparator orientation="portrait" onDrag={noop} />);
    expect(screen.getByTestId('split-separator')).toBeTruthy();
    expect(screen.getByTestId('split-separator-pill-horizontal')).toBeTruthy();
  });

  test('[P0] 5.2-UNIT-021: renders vertical pill in landscape orientation', () => {
    render(<SplitSeparator orientation="landscape" onDrag={noop} />);
    expect(screen.getByTestId('split-separator')).toBeTruthy();
    expect(screen.getByTestId('split-separator-pill-vertical')).toBeTruthy();
  });

  test('[P1] 5.2-UNIT-022: horizontal pill has correct 40×4 dimensions', () => {
    render(<SplitSeparator orientation="portrait" onDrag={noop} />);
    const pill = screen.getByTestId('split-separator-pill-horizontal');
    const { style } = pill.props;
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flatStyle.width).toBe(40);
    expect(flatStyle.height).toBe(4);
  });

  test('[P1] 5.2-UNIT-023: vertical pill has correct 4×40 dimensions', () => {
    render(<SplitSeparator orientation="landscape" onDrag={noop} />);
    const pill = screen.getByTestId('split-separator-pill-vertical');
    const { style } = pill.props;
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flatStyle.width).toBe(4);
    expect(flatStyle.height).toBe(40);
  });
});
