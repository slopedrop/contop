import React from 'react';
import { Text } from 'react-native';

function IconMock(props: { name?: string; testID?: string }) {
  return React.createElement(Text, { testID: props.testID }, props.name);
}

export const Ionicons = IconMock;
