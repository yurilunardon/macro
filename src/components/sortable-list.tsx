import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  FadeOut,
  Keyframe,
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

const ROW_OUT = FadeOut.duration(150);
/** Width of "Elimina", as the button a swipe reveals. */
const ACTION_WIDTH = 88;
/** How far the text moves to make room for the ⊖: its width and its gap. */
export const SORTABLE_SHIFT = 34;
/**
 * Room kept free at the end of a row's text outside edit mode: there the chevron (13) stands where
 * the ≡ (18) and the ⊖ would be, and the text, as wide in both modes, is cut at the same letter.
 */
export const SORTABLE_TEXT_SLACK = SORTABLE_SHIFT + 18 - 13;
/** As long as the text takes to slide over, so the ⊖ comes in beside it rather than on top. */
export const SORTABLE_ENTER_MS = 260;
const MINUS_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateX: -SORTABLE_SHIFT }] },
  100: { opacity: 1, transform: [{ translateX: 0 }] },
}).duration(SORTABLE_ENTER_MS);
const HANDLE_IN = new Keyframe({ 0: { opacity: 0 }, 100: { opacity: 1 } }).duration(SORTABLE_ENTER_MS);

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
  /** Rows under the sortable ones, in the same card: what stays of the list while editing. */
  footer?: ReactNode;
};

/**
 * Rows reordered by dragging, as in Reminders: hold a row (or its ≡ handle) and it lifts, the
 * others make room as it moves, and it drops into place when let go. The red ⊖ turns and
 * brings out "Elimina" on the right; a tap anywhere else on the row puts it back.
 */
export function SortableList<T>({ items, keyOf, rowHeight, renderRow, onReorder, onRemove, footer }: SortableListProps<T>) {
  const theme = useTheme();
  const [asking, setAsking] = useState<string | null>(null);
  const keys = items.map(keyOf);
  const signature = keys.join('|');
  const positions = useSharedValue<Positions>(positionsOf(keys));

  // The list is as tall as its rows; with one more or less it grows or shrinks along with the
  // rows sliding into place, so what is under it follows instead of jumping.
  const height = useSharedValue(rowHeight * items.length);
  const heightStyle = useAnimatedStyle(() => ({ height: height.get() }));

  // New data (another row, or the saved order coming back) resets the positions.
  useEffect(() => {
    const next = signature === '' ? [] : signature.split('|');
    positions.set(positionsOf(next));
    height.set(withSpring(rowHeight * next.length, SETTLE));
  }, [signature, positions, height, rowHeight]);

  const drop = () => {
    const order = Object.entries(positions.get())
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => key);
    if (order.join('|') !== signature) onReorder(order);
  };

  return (
    <View style={[styles.list, { backgroundColor: theme.card }]}>
    <Animated.View style={heightStyle}>
      {items.map((item) => {
        const key = keyOf(item);
        return (
          <SortableRow
            key={key}
            id={key}
            positions={positions}
            rowHeight={rowHeight}
            count={items.length}
            roundBottom={!footer}
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
    </Animated.View>
    {/* The last row's own line already parts it from what follows. */}
    {footer}
    </View>
  );
}

type SortableRowProps = {
  id: string;
  positions: SharedValue<Positions>;
  rowHeight: number;
  count: number;
  /** The last row rounds its bottom corners as the card's, unless rows follow it. */
  roundBottom: boolean;
  onDrop: () => void;
  asking: boolean;
  onAsk?: (ask: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
};

function SortableRow({ id, positions, rowHeight, count, roundBottom, onDrop, asking, onAsk, onRemove, children }: SortableRowProps) {
  const theme = useTheme();
  const top = useSharedValue((positions.get()[id] ?? 0) * rowHeight);
  const startTop = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lifted = useSharedValue(0);
  // Tapping the ⊖ slides the row left onto "Elimina", as in Clock.
  const slide = useSharedValue(0);
  useEffect(() => {
    slide.set(withSpring(asking ? -ACTION_WIDTH : 0, SETTLE));
  }, [asking, slide]);

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

  // The card's corners belong to the first and last rows, which carry them as they move; a lifted row
  // rounds all four.
  const corners = () => {
    'worklet';
    const position = positions.get()[id] ?? 0;
    const lift = lifted.get() * Radius.md;
    const top = position === 0 ? Radius.lg : lift;
    const bottom = roundBottom && position === count - 1 ? Radius.lg : lift;
    return { borderTopLeftRadius: top, borderTopRightRadius: top, borderBottomLeftRadius: bottom, borderBottomRightRadius: bottom };
  };
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: top.get() }, { scale: 1 + lifted.get() * 0.03 }],
    zIndex: dragging.get() ? 10 : 0,
    shadowOpacity: lifted.get() * 0.25,
    ...corners(),
  }));
  const clip = useAnimatedStyle(() => corners());
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slide.get() }] }));
  const minusStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${(slide.get() / ACTION_WIDTH) * 90}deg` }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View exiting={ROW_OUT} style={[styles.row, { height: rowHeight, backgroundColor: theme.card }, style]}>
        <Animated.View style={[styles.clip, clip]}>
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityElementsHidden={!asking}
            style={({ pressed }) => [styles.action, { backgroundColor: theme.danger }, pressed && { opacity: 0.7 }]}>
            <AppText variant="subhead" weight="600" style={styles.deleteText}>
              Elimina
            </AppText>
          </Pressable>
          <Animated.View style={[styles.slider, { backgroundColor: theme.card }, slideStyle]}>
            {onAsk ? (
              <Animated.View entering={MINUS_IN}>
                <Pressable
                  onPress={() => {
                    haptics.selection();
                    onAsk(!asking);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Elimina">
                  <Animated.View style={minusStyle}>
                    <Icon name="minus.circle.fill" size={22} tone="danger" />
                  </Animated.View>
                </Pressable>
              </Animated.View>
            ) : null}
            <Pressable style={styles.content} disabled={!asking} onPress={() => onAsk?.(false)}>
              {children}
            </Pressable>
            <Animated.View entering={HANDLE_IN}>
              <Icon name="line.3.horizontal" size={18} tone="textTertiary" />
            </Animated.View>
            <View style={[styles.divider, { backgroundColor: theme.separator }]} />
          </Animated.View>
        </Animated.View>
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
    borderCurve: 'continuous',
    shadowColor: '#000',
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  clip: { flex: 1, overflow: 'hidden', borderCurve: 'continuous' },
  slider: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  action: { position: 'absolute', top: 0, bottom: 0, right: 0, width: ACTION_WIDTH, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  deleteText: { color: '#FFFFFF' },
  divider: { position: 'absolute', left: Spacing.lg, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
