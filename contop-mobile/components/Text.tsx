import React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

type TextProps = RNTextProps & {
  className?: string;
};

export default function Text({ className = '', ...props }: TextProps) {
  return <RNText className={`font-sans text-white ${className}`} {...props} />;
}
