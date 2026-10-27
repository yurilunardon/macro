import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import Sortable from 'react-native-sortables';

import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';

/** Rotation either way, in degrees: small, since the blocks are big. */
const WOBBLE = 0.5;

type JiggleProps = {
  /** The list is being edited: wobble, show the ×, ignore taps on the content. */
  editing: boolean;
  onRemove: () => void;
  removeLabel: string;
  /** Space above the block, where the × sits half outside. */
  inset: number;
  children: ReactNode;
};

/**
 * A block of a sortable list in edit mode, as an app on the Home Screen: it wobbles a little
 * out of step with the others and shows a × to remove it, while a tap on its content does
 * nothing. Dragging is the sortable list's job.
 */
export function Jiggle({ editing, onRemove, removeLabel, inset, children }: JiggleProps) {
  const theme = useTheme();
  const wobble = useSharedValue(0);
  useEffect(() => {
    if (!editing) {
      wobble.set(withTiming(0, { duration: 120 }));
      return;
    }
    wobble.set(
      withDelay(
        Math.random() * 120,
        withRepeat(withSequence(withTiming(WOBBLE, { duration: 130 }), withTiming(-WOBBLE, { duration: 130 })), -1, true),
      ),
    );
  }, [editing, wobble]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${wobble.get()}deg` }] }));

  return (
    <Animated.View style={[{ paddingTop: inset }, style]}>
      {children}
      {editing ? <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} /> : null}
      {editing ? (
        <Animated.View entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(140)} style={[styles.remove, { top: inset - 9 }]}>
          <Sortable.Touchable onTap={onRemove} accessibilityRole="button" accessibilityLabel={removeLabel}>
            <View style={[styles.removeButton, { backgroundColor: theme.textSecondary }]}>
              <Icon name="xmark" size={11} weight="bold" color={theme.background} />
            </View>
          </Sortable.Touchable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  remove: { position: 'absolute', left: -7, zIndex: 2 },
  removeButton: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
