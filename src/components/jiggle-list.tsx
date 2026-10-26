import { createContext, useContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { Icon } from './icon';

/** Rotation either way while jiggling, in degrees: small, since the blocks are big. */
const WOBBLE = 0.6;
const SHIFT_SPRING = { duration: 300, dampingRatio: 1 };
/** How long a finger rests on a block before it lifts it. */
const LIFT_DELAY = 160;
/** Near the top or bottom of the screen a dragged block scrolls the page, up to this fast. */
const EDGE = 110;
const MAX_SCROLL_SPEED = 14;

const lift = haptics.medium;
const tick = haptics.selection;

/** The scroll view holding the list, so a block dragged to an edge can scroll it. */
export type JiggleScroll = {
  ref: AnimatedRef<Animated.ScrollView>;
  offset: SharedValue<number>;
  /** Height of the content minus the height of the scroll view. */
  maxOffset: SharedValue<number>;
};

type Drag = {
  /** Key of the block being dragged, '' when none. */
  active: SharedValue<string>;
  /** Index the dragged block would drop at, among the others. */
  target: SharedValue<number>;
  translation: SharedValue<number>;
  /** Finger position on screen, for scrolling at the edges. */
  fingerY: SharedValue<number>;
  scrollStart: SharedValue<number>;
  /** Where the dragged block is drawn, relative to its place in the list. */
  dragY: SharedValue<number>;
  keys: SharedValue<string[]>;
  heights: SharedValue<Record<string, number>>;
  /** True for a frame after a drop, so the blocks take their new places without animating. */
  instant: SharedValue<boolean>;
  /** Let go: the block springs to its slot and no longer follows the finger. */
  dropping: SharedValue<boolean>;
};

/** Index the dragged block would take, and its offset from its own place if it went there. */
function dropPlace(drag: Drag): { target: number; offset: number } {
  'worklet';
  const keys = drag.keys.get();
  const heights = drag.heights.get();
  const active = drag.active.get();
  let origin = 0;
  for (const key of keys) {
    if (key === active) break;
    origin += heights[key] ?? 0;
  }
  const centre = origin + drag.dragY.get() + (heights[active] ?? 0) / 2;
  let target = 0;
  let top = 0;
  let above = 0;
  for (const key of keys) {
    if (key === active) continue;
    const h = heights[key] ?? 0;
    if (centre > top + h / 2) {
      target += 1;
      above = top + h;
    }
    top += h;
  }
  return { target, offset: above - origin };
}

type Item = { key: string; drag: Drag; scroll: JiggleScroll; editing: boolean; startEditing: () => void; onDrop: () => void };
const ItemContext = createContext<Item | null>(null);

type JiggleListProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** The blocks jiggle, show their × and can be dragged into another order. */
  editing: boolean;
  onStartEditing: () => void;
  onReorder: (keys: string[]) => void;
  onRemove: (item: T) => void;
  scroll: JiggleScroll;
  /** Space above each block. */
  gap: number;
};

/**
 * Blocks reordered in place, as apps on the Home Screen: in edit mode they jiggle, show a ×
 * to remove them and follow the finger when held; the others slide out of the way, and the
 * page scrolls when a block is taken to its top or bottom edge. Holding a block's handle (see
 * JiggleHandle) also enters edit mode and picks the block up in one go.
 */
export function JiggleList<T>({
  items,
  keyOf,
  renderItem,
  editing,
  onStartEditing,
  onReorder,
  onRemove,
  scroll,
  gap,
}: JiggleListProps<T>) {
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keys = items.map(keyOf);
  const signature = keys.join('|');

  const drag: Drag = {
    active: useSharedValue(''),
    target: useSharedValue(0),
    translation: useSharedValue(0),
    fingerY: useSharedValue(0),
    scrollStart: useSharedValue(0),
    dragY: useSharedValue(0),
    keys: useSharedValue(keys),
    heights: useSharedValue<Record<string, number>>({}),
    instant: useSharedValue(false),
    dropping: useSharedValue(false),
  };

  // The saved order has come back: the blocks are in their new places in the layout, so the
  // offsets that showed them there during the drag go back to zero at once.
  useLayoutEffect(() => {
    drag.instant.set(true);
    drag.keys.set(signature === '' ? [] : signature.split('|'));
    drag.active.set('');
    drag.dragY.set(0);
    drag.dropping.set(false);
    const frame = requestAnimationFrame(() => drag.instant.set(false));
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // While a block is held: follow the finger, scroll at the edges, work out where it would drop.
  const top = insets.top + EDGE;
  const bottom = screenHeight - insets.bottom - EDGE;
  useFrameCallback(() => {
    if (drag.active.get() === '' || drag.dropping.get()) return;
    const finger = drag.fingerY.get();
    const speed =
      finger < top ? -MAX_SCROLL_SPEED * Math.min(1, (top - finger) / EDGE) : finger > bottom ? MAX_SCROLL_SPEED * Math.min(1, (finger - bottom) / EDGE) : 0;
    if (speed !== 0) {
      const next = Math.min(Math.max(scroll.offset.get() + speed, 0), Math.max(0, scroll.maxOffset.get()));
      if (next !== scroll.offset.get()) scrollTo(scroll.ref, 0, next, false);
    }
    drag.dragY.set(drag.translation.get() + scroll.offset.get() - drag.scrollStart.get());
    const { target } = dropPlace(drag);
    if (target !== drag.target.get()) {
      drag.target.set(target);
      scheduleOnRN(tick);
    }
  });

  const drop = () => {
    const order = drag.keys.get().filter((key) => key !== drag.active.get());
    order.splice(drag.target.get(), 0, drag.active.get());
    if (order.join('|') === signature) {
      drag.active.set('');
      drag.dragY.set(0);
      drag.dropping.set(false);
      return;
    }
    onReorder(order);
  };

  return (
    <View>
      {items.map((item) => {
        const key = keyOf(item);
        return (
          <ItemContext.Provider key={key} value={{ key, drag, scroll, editing, startEditing: onStartEditing, onDrop: drop }}>
            <JiggleItem gap={gap} onRemove={() => onRemove(item)}>
              {renderItem(item)}
            </JiggleItem>
          </ItemContext.Provider>
        );
      })}
    </View>
  );
}

/** The pan that lifts a block: on the whole block in edit mode, on its handle otherwise. */
function useLiftGesture(item: Item, enabled: boolean) {
  const { key, drag, scroll, startEditing, onDrop } = item;
  return usePanGesture({
    enabled,
    activateAfterLongPress: LIFT_DELAY,
    onActivate: (event) => {
      'worklet';
      drag.translation.set(0);
      drag.fingerY.set(event.absoluteY);
      drag.scrollStart.set(scroll.offset.get());
      drag.dragY.set(0);
      drag.dropping.set(false);
      drag.active.set(key);
      drag.target.set(drag.keys.get().indexOf(key));
      scheduleOnRN(lift);
      scheduleOnRN(startEditing);
    },
    onUpdate: (event) => {
      'worklet';
      drag.translation.set(event.translationY);
      drag.fingerY.set(event.absoluteY);
    },
    onFinalize: () => {
      'worklet';
      if (drag.active.get() !== key || drag.dropping.get()) return;
      drag.dropping.set(true);
      const { offset } = dropPlace(drag);
      drag.dragY.set(
        withSpring(offset, SHIFT_SPRING, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(onDrop);
        }),
      );
    },
  });
}

function JiggleItem({ gap, onRemove, children }: { gap: number; onRemove: () => void; children: ReactNode }) {
  const theme = useTheme();
  const item = useContext(ItemContext);
  if (!item) throw new Error('JiggleItem outside JiggleList');
  const { key, drag, editing } = item;
  const pan = useLiftGesture(item, editing);

  // Each block wobbles a little out of step with the others, as on the Home Screen.
  const wobble = useSharedValue(0);
  useEffect(() => {
    if (!editing) {
      wobble.set(withTiming(0, { duration: 120 }));
      return;
    }
    const phase = Math.random() * 120;
    wobble.set(
      withDelay(
        phase,
        withRepeat(withSequence(withTiming(WOBBLE, { duration: 130 }), withTiming(-WOBBLE, { duration: 130 })), -1, true),
      ),
    );
  }, [editing, wobble]);

  const style = useAnimatedStyle(() => {
    const active = drag.active.get();
    if (active === key) {
      return {
        zIndex: 10,
        transform: [{ translateY: drag.dragY.get() }, { scale: withSpring(1.03, SHIFT_SPRING) }, { rotate: '0deg' }],
        shadowOpacity: withTiming(0.3, { duration: 150 }),
      };
    }
    let shift = 0;
    if (active !== '') {
      const keys = drag.keys.get();
      const from = keys.indexOf(active);
      const index = keys.indexOf(key);
      const to = drag.target.get();
      const h = drag.heights.get()[active] ?? 0;
      if (from < to && index > from && index <= to) shift = -h;
      else if (to < from && index >= to && index < from) shift = h;
    }
    const instant = drag.instant.get();
    return {
      zIndex: 0,
      transform: [
        { translateY: instant ? shift : withSpring(shift, SHIFT_SPRING) },
        { scale: instant ? 1 : withSpring(1, SHIFT_SPRING) },
        { rotate: `${wobble.get()}deg` },
      ],
      shadowOpacity: 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.item, { paddingTop: gap }, style]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          drag.heights.set({ ...drag.heights.get(), [key]: height });
        }}>
        {children}
        {editing ? (
          // In edit mode a tap on a block does nothing, as on the Home Screen: no field or button
          // inside it reacts, while holding it still drags it.
          <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} />
        ) : null}
        {editing ? (
          <Animated.View entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)} style={[styles.remove, { top: gap - 9 }]}>
            <Pressable
              onPress={onRemove}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Elimina esercizio"
              style={[styles.removeButton, { backgroundColor: theme.textSecondary }]}>
              <Icon name="xmark" size={11} weight="bold" color={theme.background} />
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Part of a block that, held, enters edit mode and lifts the block at once (its header, say).
 * In edit mode the whole block can be held instead.
 */
export function JiggleHandle({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const item = useContext(ItemContext);
  if (!item) return <View style={style}>{children}</View>;
  return (
    <HandleGesture item={item} style={style}>
      {children}
    </HandleGesture>
  );
}

function HandleGesture({ item, style, children }: { item: Item; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  // Stays enabled when edit mode starts, so the block it lifted keeps following the finger.
  const pan = useLiftGesture(item, true);
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  item: { shadowColor: '#000', shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  remove: { position: 'absolute', left: -7, zIndex: 2 },
  removeButton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
