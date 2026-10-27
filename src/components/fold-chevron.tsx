import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Icon } from './icon';

/** The chevron of a section that folds: down when open, turning to point right when folded. */
export function FoldChevron({ open }: { open: boolean }) {
  const turn = useSharedValue(open ? 0 : -90);
  useEffect(() => {
    turn.set(withSpring(open ? 0 : -90, { duration: 300, dampingRatio: 1 }));
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon name="chevron.down" size={12} weight="semibold" tone="textTertiary" />
    </Animated.View>
  );
}
