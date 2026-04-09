import React, { useMemo, useCallback } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

type Props = {
  children: string;
  fontSize?: number;
  color?: string;
};

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/**
 * Renders markdown-formatted text with dark-theme styling.
 * Falls back gracefully - plain text renders identically to a normal Text component.
 */
export default function MarkdownContent({ children, fontSize = 15, color = '#D1D5DB' }: Props) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        body: { color, fontSize, lineHeight: fontSize * 1.5 },
        heading1: { color: '#F3F4F6', fontSize: fontSize + 4, fontWeight: '700', marginTop: 12, marginBottom: 6 },
        heading2: { color: '#F3F4F6', fontSize: fontSize + 2, fontWeight: '600', marginTop: 10, marginBottom: 4 },
        heading3: { color: '#E5E7EB', fontSize: fontSize + 1, fontWeight: '600', marginTop: 8, marginBottom: 4 },
        heading4: { color: '#E5E7EB', fontSize, fontWeight: '600', marginTop: 6, marginBottom: 2 },
        heading5: { color: '#E5E7EB', fontSize, fontWeight: '600' },
        heading6: { color: '#D1D5DB', fontSize, fontWeight: '500' },
        strong: { color: '#F3F4F6', fontWeight: '600' },
        em: { color, fontStyle: 'italic' },
        link: { color: '#60A5FA', textDecorationLine: 'underline' },
        blockquote: {
          backgroundColor: '#111111',
          borderLeftWidth: 3,
          borderLeftColor: '#374151',
          paddingLeft: 12,
          paddingVertical: 6,
          marginVertical: 6,
        },
        code_inline: {
          backgroundColor: '#1F1F1F',
          color: '#A78BFA',
          fontFamily: mono,
          fontSize: fontSize - 1,
          paddingHorizontal: 5,
          paddingVertical: 2,
          borderRadius: 4,
        },
        code_block: {
          backgroundColor: '#111111',
          borderWidth: 1,
          borderColor: '#1F1F1F',
          borderRadius: 8,
          padding: 12,
          fontFamily: mono,
          fontSize: fontSize - 2,
          color: '#D1D5DB',
          lineHeight: (fontSize - 2) * 1.5,
        },
        fence: {
          backgroundColor: '#111111',
          borderWidth: 1,
          borderColor: '#1F1F1F',
          borderRadius: 8,
          padding: 12,
          fontFamily: mono,
          fontSize: fontSize - 2,
          color: '#D1D5DB',
          lineHeight: (fontSize - 2) * 1.5,
          marginVertical: 8,
        },
        bullet_list: { marginVertical: 4 },
        ordered_list: { marginVertical: 4 },
        list_item: { flexDirection: 'row', marginVertical: 2 },
        bullet_list_icon: { color: '#6B7280', fontSize: fontSize - 2, marginRight: 8, marginTop: 2 },
        ordered_list_icon: { color: '#6B7280', fontSize: fontSize - 2, marginRight: 8, marginTop: 2 },
        hr: { backgroundColor: '#1F1F1F', height: 1, marginVertical: 12 },
        table: { borderWidth: 1, borderColor: '#1F1F1F', borderRadius: 4, marginVertical: 8 },
        thead: { backgroundColor: '#111111' },
        th: { color: '#E5E7EB', fontWeight: '600', padding: 8, borderBottomWidth: 1, borderColor: '#1F1F1F' },
        td: { color, padding: 8, borderBottomWidth: 1, borderColor: '#1F1F1F' },
        tr: { borderBottomWidth: 1, borderColor: '#1F1F1F' },
        paragraph: { marginVertical: 6 },
      }),
    [fontSize, color],
  );

  const handleLinkPress = useCallback((url: string) => {
    if (/^https?:\/\//i.test(url)) {
      Linking.openURL(url).catch(() => { });
    }
    return false;
  }, []);

  return (
    <Markdown style={styles} onLinkPress={handleLinkPress}>{children}</Markdown>
  );
}
