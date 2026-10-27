import type { SFSymbol } from 'expo-symbols';
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';

/** With `layout`, it grows and shrinks smoothly when what it holds changes. */
export function Card({
  children,
  style,
  layout,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  layout?: ComponentProps<typeof Animated.View>['layout'];
}) {
  const theme = useTheme();
  return (
    <Animated.View layout={layout} style={[styles.card, { backgroundColor: theme.card }, style]}>
      {children}
    </Animated.View>
  );
}

/** Title above a group, iOS Settings style. */
export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <AppText variant="footnote" tone="textSecondary" weight="600" style={styles.sectionTitleText}>
        {children.toUpperCase()}
      </AppText>
      {action}
    </View>
  );
}

export function SectionFooter({ children }: { children: ReactNode }) {
  return (
    <AppText variant="footnote" tone="textSecondary" style={styles.sectionFooter}>
      {children}
    </AppText>
  );
}

/** A card of rows with hairline separators between them. With `layout`, it resizes smoothly. */
export function ListGroup({ children, layout }: { children: ReactNode; layout?: ComponentProps<typeof Animated.View>['layout'] }) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <Animated.View layout={layout} style={[styles.group, { backgroundColor: theme.card }]}>
      {items.map((child, index) => (
        <Fragment key={child.key ?? index}>
          {index > 0 && <View style={[styles.divider, { backgroundColor: theme.separator }]} />}
          {child}
        </Fragment>
      ))}
    </Animated.View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string | null;
  /** Text or element on the right. */
  detail?: ReactNode;
  icon?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  accessibilityHint?: string;
};

export function Row({
  title,
  subtitle,
  detail,
  icon,
  onPress,
  onLongPress,
  chevron = onPress !== undefined,
  destructive = false,
  accessibilityHint,
}: RowProps) {
  const theme = useTheme();
  const content = (
    <>
      {icon}
      <View style={styles.rowText}>
        <AppText tone={destructive ? 'danger' : 'text'} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {typeof detail === 'string' ? (
        <AppText tone="textSecondary" numeric>
          {detail}
        </AppText>
      ) : (
        detail
      )}
      {chevron ? <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" /> : null}
    </>
  );

  if (!onPress && !onLongPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      {content}
    </Pressable>
  );
}

/** A row that starts an action, e.g. "Aggiungi ingrediente", in the accent colour. */
export function ActionRow({
  label,
  onPress,
  symbol = 'plus.circle.fill',
}: {
  label: string;
  onPress: () => void;
  symbol?: SFSymbol;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <Icon name={symbol} size={20} tone="accent" />
      <AppText tone="accent" weight="600" style={styles.rowText}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    padding: Spacing.lg,
  },
  group: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    paddingTop: Spacing.xl,
  },
  sectionTitleText: { letterSpacing: 0.3 },
  sectionFooter: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
});
