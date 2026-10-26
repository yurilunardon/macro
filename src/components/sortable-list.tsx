import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { Icon } from './icon';

const SETTLE = { duration: 320, dampingRatio: 1 };
/** Holding a row this long picks it up; a quicker swipe still scrolls the page. */
const LIFT_DELAY = 180;

const lift = haptics.medium;
const tick = haptics.selection;

type Positions = Record<string, number>;

function positionsOf(keys: readonly string[]): Positions {
  return Object.fromEntries(keys.map((key, index) => [key, index]));
}

type SortableListProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** Every row has this height, so the list knows where each one goes. */
  rowHeight: number;
  renderRow: (item: T) => ReactNode;
  /** Called with the keys in their new order once a row is dropped somewhere else. */
  onReorder: (keys: string[]) => void;
};

/**
 * Rows reordered by dragging, as in Reminders: hold a row (or its ≡ handle) and it lifts, the
 * others make room as it moves, and it drops into place when let go.
 */
export function SortableList<T>({ items, keyOf, rowHeight, renderRow, onReorder }: SortableListProps<T>) {
  const theme = useTheme();
  const keys = items.map(keyOf);
  const signature = keys.join('|');
  const positions = useSharedValue<Positions>(positionsOf(keys));

  // New data (another row, or the saved order coming back) resets the positions.
  useEffect(() => {
    positions.set(positionsOf(signature === '' ? [] : signature.split('|')));
  }, [signature, positions]);

  const drop = () => {
    const order = Object.entries(positions.get())
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key);
    if (order.join('|') !== signature) onReorder(order);
  };

  return (
    <View style={[styles.list, { height: rowHeight * items.length, backgroundColor: theme.card }]}>
      {items.map((item) => {
        const key = keyOf(item);
        return (
          <SortableRow key={key} id={key} positions={positions} rowHeight={rowHeight} count={items.length} onDrop={drop}>
            {renderRow(item)}
          </SortableRow>
        );
      })}
    </View>
  );
}

type SortableRowProps = {
  id: string;
  positions: SharedValue<Positions>;
  rowHeight: number;
  count: number;
  onDrop: () => void;
  children: ReactNode;
};

function SortableRow({ id, positions, rowHeight, count, onDrop, children }: SortableRowProps) {
  const theme = useTheme();
  const top = useSharedValue((positions.get()[id] ?? 0) * rowHeight);
  const startTop = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lifted = useSharedValue(0);

  // When another row takes this one's place, slide to the new one.
  useAnimatedReaction(
    () => positions.get()[id],
    (position, previous) => {
      if (position === undefined || position === previous || dragging.get()) return;
      top.set(withSpring(position * rowHeight, SETTLE));
    },
  );

  const pan = usePanGesture({
    activateAfterLongPress: LIFT_DELAY,
    onActivate: () => {
      'worklet';
      dragging.set(true);
      startTop.set(top.get());
      lifted.set(withTiming(1, { duration: 150 }));
      scheduleOnRN(lift);
    },
    onUpdate: (event) => {
      'worklet';
      const y = Math.min(Math.max(startTop.get() + event.translationY, -rowHeight * 0.3), (count - 0.7) * rowHeight);
      top.set(y);
      const current = positions.get();
      const from = current[id];
      const to = Math.min(count - 1, Math.max(0, Math.round(y / rowHeight)));
      if (from === undefined || to === from) return;
      const next: Positions = {};
      for (const key of Object.keys(current)) {
        const p = current[key];
        if (key === id) next[key] = to;
        else if (from < to && p > from && p <= to) next[key] = p - 1;
        else if (from > to && p >= to && p < from) next[key] = p + 1;
        else next[key] = p;
      }
      positions.set(next);
      scheduleOnRN(tick);
    },
    onFinalize: () => {
      'worklet';
      if (!dragging.get()) return;
      dragging.set(false);
      lifted.set(withTiming(0, { duration: 200 }));
      top.set(withSpring((positions.get()[id] ?? 0) * rowHeight, SETTLE));
      scheduleOnRN(onDrop);
    },
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: top.get() }, { scale: 1 + lifted.get() * 0.03 }],
    zIndex: dragging.get() ? 10 : 0,
    borderRadius: lifted.get() * Radius.md,
    shadowOpacity: lifted.get() * 0.25,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, { height: rowHeight, backgroundColor: theme.card }, style]}>
        <View style={styles.content}>{children}</View>
        <Icon name="line.3.horizontal" size={18} tone="textTertiary" />
        <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: Radius.lg, borderCurve: 'continuous' },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  content: { flex: 1 },
  divider: { position: 'absolute', left: Spacing.lg, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
