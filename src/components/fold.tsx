import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

/** About what iOS takes to open a row in Settings or a section in Mail. */
export const FOLD_MS = 320;
const EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * What opens under a row: its height grows from nothing to what the content needs, so the card
 * around it stretches with its rounded corners and what is below slides down, all in one movement.
 * Shown at once, the card jumped to its new size while only the rows below slid. The content
 * stays built once opened, so folding it again needs nothing new.
 */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [built, setBuilt] = useState(open);
  if (open && !built) setBuilt(true);
  // Open from the start, it is laid out as anything else until first folded: clipped to a height
  // not measured yet, it would show empty for a frame.
  const [free, setFree] = useState(open);
  const [first, setFirst] = useState(open);
  if (open !== first && free) setFree(false);
  if (open !== first) setFirst(open);
  const height = useSharedValue(0);
  const shown = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    shown.set(withTiming(open ? 1 : 0, { duration: reduced ? 0 : FOLD_MS, easing: EASING }));
  }, [open, reduced, shown]);

  const clip = useAnimatedStyle(() => ({ height: height.get() * shown.get() }));
  // The content fades in over the last part of the opening and out over the first of the closing.
  const content = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, (shown.get() - 0.3) / 0.7)) }));

  return (
    <Animated.View style={free ? undefined : [styles.clip, clip]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View
        style={free ? undefined : [styles.content, content]}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          // Content changing while open (a list loading) grows or shrinks the card smoothly too.
          height.set(shown.get() > 0 && height.get() > 0 ? withTiming(next, { duration: reduced ? 0 : FOLD_MS, easing: EASING }) : next);
        }}>
        {built ? children : <View />}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // Laid out at its own height whatever the clip's, so it can be measured.
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
});
