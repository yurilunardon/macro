export type TimePickerProps = {
  hour: number;
  minute: number;
  onChange: (time: { hour: number; minute: number }) => void;
  accessibilityLabel: string;
};
