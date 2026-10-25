import * as Haptics from 'expo-haptics';

function play(feedback: () => Promise<void>): void {
  // Haptics are a bonus: where they are unavailable, nothing else changes.
  feedback().catch(() => {});
}

/**
 * The haptic feedback the app uses, as in Apple's apps: one per action, at the moment the
 * screen changes, never as the only feedback. iOS silences them when system haptics are off.
 */
export const haptics = {
  /** A value moves to the next step: a segment, a chip, the day. */
  selection: () => play(() => Haptics.selectionAsync()),
  /** Something light snaps into place, or a swipe is pulled back. */
  light: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A swipe reaches the point where letting go deletes. */
  medium: () => play(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => play(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
