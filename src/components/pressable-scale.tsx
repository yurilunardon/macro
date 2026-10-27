import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '@/services/haptics';

type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it sinks under the finger. */
  scaleTo?: number;
};

/**
 * A card that sinks under the finger and springs back when let go, with a tap on press, as the
 * cards in Apple's apps. Plain dimming felt limp on something as big as a card.
 */
export function PressableScale({ children, style, scaleTo = 0.96, onPressIn, onPressOut, onPress, ...props }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        scale.set(withSpring(scaleTo, { duration: 180, dampingRatio: 1 }));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, { duration: 450, dampingRatio: 0.55 }));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        haptics.light();
        onPress?.(event);
      }}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
