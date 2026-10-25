import { StyleSheet, Text, type TextProps } from 'react-native';

import type { ColorName } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'display' | 'title' | 'title2' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption';

export type AppTextProps = TextProps & {
  variant?: Variant;
  tone?: ColorName;
  /** Tabular figures, so numbers do not shift while they change. */
  numeric?: boolean;
  weight?: '400' | '500' | '600' | '700' | '800';
  align?: 'left' | 'center' | 'right';
};

export function AppText({
  variant = 'body',
  tone = 'text',
  numeric = false,
  weight,
  align,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles[variant],
        { color: theme[tone] },
        numeric && styles.numeric,
        weight !== undefined && { fontWeight: weight },
        align !== undefined && { textAlign: align },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 },
  callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  numeric: { fontVariant: ['tabular-nums'] },
});
