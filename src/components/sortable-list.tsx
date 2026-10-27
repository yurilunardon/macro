import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeIn,
  FadeOut,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Icon } from './icon';

const SETTLE = { duration: 320, dampingRatio: 1 };
/** Holding a row this long picks it up; a quicker swipe still scrolls the page. */
const LIFT_DELAY = 180;

const ASK_IN = FadeIn.duration(160);
const ASK_OUT = FadeOut.duration(120);

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
  /** With it, each row has a red ⊖ on the left, as lists in edit mode on iOS. */
  onRemove?: (item: T) => void;
};

/**
 * Rows reordered by dragging, as in Reminders: hold a row (or its ≡ handle) and it lifts, the
 * others make room as it moves, and it drops into place when let go. The red ⊖ turns and
 * brings out "Elimina" on the right; a tap anywhere else on the row puts it back.
 */
export function SortableList<T>({ items, keyOf, rowHeight, renderRow, onReorder, onRemove }: SortableListProps<T>) {
  const theme = useTheme();
  const [asking, setAsking] = useState<string | null>(null);
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
          <SortableRow
            key={key}
            id={key}
            positions={positions}
            rowHeight={rowHeight}
            count={items.length}
            onDrop={drop}
            asking={asking === key}
            onAsk={onRemove ? (ask) => setAsking(ask ? key : null) : undefined}
            onRemove={() => {
              setAsking(null);
              onRemove?.(item);
            }}>
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
  asking: boolean;
  onAsk?: (ask: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
};

function SortableRow({ id, positions, rowHeight, count, onDrop, asking, onAsk, onRemove, children }: SortableRowProps) {
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
        {onAsk ? (
          <Pressable
            onPress={() => {
              haptics.selection();
              onAsk(!asking);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Elimina">
            <Animated.View style={asking ? styles.turned : null}>
              <Icon name="minus.circle.fill" size={22} tone="danger" />
            </Animated.View>
          </Pressable>
        ) : null}
        <Pressable style={styles.content} disabled={!asking} onPress={() => onAsk?.(false)}>
          {children}
        </Pressable>
        {asking ? (
          <Animated.View entering={ASK_IN} exiting={ASK_OUT}>
            <Pressable
              onPress={onRemove}
              accessibilityRole="button"
              style={({ pressed }) => [styles.delete, { backgroundColor: theme.danger }, pressed && { opacity: 0.6 }]}>
              <AppText variant="subhead" weight="600" style={styles.deleteText}>
                Elimina
              </AppText>
            </Pressable>
          </Animated.View>
        ) : (
          <Icon name="line.3.horizontal" size={18} tone="textTertiary" />
        )}
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
  // The ⊖ turns upright once tapped, as on iOS, while "Elimina" comes in.
  turned: { transform: [{ rotate: '-90deg' }] },
  delete: { height: 36, paddingHorizontal: Spacing.md, borderRadius: 12, borderCurve: 'continuous', justifyContent: 'center' },
  deleteText: { color: '#FFFFFF' },
  divider: { position: 'absolute', left: Spacing.lg, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
