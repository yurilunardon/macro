import type { ReactElement, ReactNode } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { closeOpenSwipeRow } from './swipe-to-delete';

type GroupedListProps<T> = {
  data: readonly T[];
  keyOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  /** Above the card, e.g. filters. */
  header?: ReactElement;
  /** Below the card, e.g. a footnote or an empty state. */
  footer?: ReactElement;
};

/**
 * A long list in one grouped card, as a screen body. Unlike ScreenScroll it draws only the rows
 * near the screen, so a library of hundreds of items opens at once, search bar included.
 */
export function GroupedList<T>({ data, keyOf, renderRow, header, footer }: GroupedListProps<T>) {
  const theme = useTheme();
  const last = data.length - 1;
  return (
    <FlatList
      data={data}
      keyExtractor={keyOf}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={closeOpenSwipeRow}
      initialNumToRender={16}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      renderItem={({ item, index }) => (
        <View
          style={[
            styles.cell,
            { backgroundColor: theme.card },
            index === 0 && styles.first,
            index === last && styles.last,
          ]}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.separator }]} /> : null}
          {renderRow(item)}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  cell: { overflow: 'hidden', borderCurve: 'continuous' },
  first: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  last: { borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg },
});
