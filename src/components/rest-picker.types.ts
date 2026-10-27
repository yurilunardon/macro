export type RestPickerProps = {
  /** Seconds of rest after each set. */
  value: number;
  onChange: (seconds: number) => void;
};

/** The longest rest offered, in minutes, and the step of the seconds wheel. */
export const REST_MAX_MINUTES = 10;
export const REST_STEP = 5;
