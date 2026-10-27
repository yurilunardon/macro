export type RangeFlagProps = {
  /** What happened, e.g. "14 ripetizioni, sopra 8–12". */
  title: string;
  /** What to do about it. */
  message: string;
  /** Reopens the set, for a count typed wrong. */
  onFix: () => void;
};
