import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import GlassPanel from './GlassPanel';

jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return {
    BlurView: ({ testID, ...props }: { testID?: string; intensity?: number; tint?: string; style?: object }) => (
      <View testID={testID ?? 'blur-view'} {...props} />
    ),
  };
});

describe('GlassPanel', () => {
  it('renders children', () => {
    render(
      <GlassPanel>
        <Text>Child content</Text>
      </GlassPanel>,
    );
    expect(screen.getByText('Child content')).toBeTruthy();
  });

  it('accepts className prop without breaking render', () => {
    const { toJSON } = render(
      <GlassPanel className="p-4">
        <Text>Content</Text>
      </GlassPanel>,
    );
    expect(toJSON()).toBeTruthy();
  });

  it('renders BlurView with dark tint and medium intensity by default', () => {
    const { toJSON } = render(
      <GlassPanel>
        <Text>Content</Text>
      </GlassPanel>,
    );
    const tree = toJSON();
    const blurView = tree.children.find(
      (child: any) => child?.props?.testID === 'blur-view',
    );
    expect(blurView).toBeTruthy();
    expect(blurView.props.tint).toBe('dark');
    expect(blurView.props.intensity).toBe(60);
  });

  it('maps intensity prop to correct blur values', () => {
    const { toJSON: lowJSON } = render(
      <GlassPanel intensity="low">
        <Text>Low</Text>
      </GlassPanel>,
    );
    const lowBlur = lowJSON().children.find(
      (child: any) => child?.props?.testID === 'blur-view',
    );
    expect(lowBlur.props.intensity).toBe(30);

    const { toJSON: highJSON } = render(
      <GlassPanel intensity="high">
        <Text>High</Text>
      </GlassPanel>,
    );
    const highBlur = highJSON().children.find(
      (child: any) => child?.props?.testID === 'blur-view',
    );
    expect(highBlur.props.intensity).toBe(90);
  });
});
