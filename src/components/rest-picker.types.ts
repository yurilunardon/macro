export type RestPickerProps = {
  /** Seconds of rest after each set. */
  value: number;
  onChange: (seconds: number) => void;
  /**
   * Drawn exactly as it looks, without the native menu behind it: while the screen is still
   * sliding in, when its SwiftUI view would make the animation stutter.
   */
  inert?: boolean;
};

/** The longest rest offered, in minutes, and the step of the seconds wheel. */
export const REST_MAX_MINUTES = 10;
export const REST_STEP = 5;
