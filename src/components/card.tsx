import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card }, style]}>{children}</View>;
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

/** A card of rows with hairline separators between them. */
export function ListGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, { backgroundColor: theme.card }]}>
      {items.map((child, index) => (
        <Fragment key={child.key ?? index}>
          {index > 0 && <View style={[styles.divider, { backgroundColor: theme.separator }]} />}
          {child}
        </Fragment>
      ))}
    </View>
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
