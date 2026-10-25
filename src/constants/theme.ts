/**
 * Design tokens. Surfaces follow iOS grouped lists; macro colours are fixed across the app so
 * protein, carbs and fat are always recognisable at a glance. The ring colours are the iOS
 * system red, orange and green, as in the Activity rings.
 */
export const Colors = {
  light: {
    background: '#F2F2F7',
    card: '#FFFFFF',
    cardPressed: '#E5E5EA',
    text: '#000000',
    textSecondary: '#6C6C70',
    textTertiary: '#AEAEB2',
    separator: '#D1D1D6',
    track: '#E5E5EA',
    accent: '#15803D',
    onAccent: '#FFFFFF',
    accentSoft: '#DCF5E3',
    danger: '#D70015',
    warning: '#B25000',
    protein: '#D9480F',
    carbs: '#0B7285',
    fat: '#9C36B5',
    ringFar: '#FF3B30',
    ringCloser: '#FF9500',
    ringOnTarget: '#34C759',
    scrim: 'rgba(0,0,0,0.55)',
  },
  dark: {
    background: '#000000',
    card: '#1C1C1E',
    cardPressed: '#2C2C2E',
    text: '#FFFFFF',
    textSecondary: '#AEAEB2',
    textTertiary: '#636366',
    separator: '#38383A',
    track: '#2C2C2E',
    accent: '#30D158',
    onAccent: '#00210B',
    accentSoft: '#0E2E18',
    danger: '#FF6961',
    warning: '#FFB340',
    protein: '#FF9F0A',
    carbs: '#3BC9DB',
    fat: '#DA8FFF',
    ringFar: '#FF453A',
    ringCloser: '#FF9F0A',
    ringOnTarget: '#30D158',
    scrim: 'rgba(0,0,0,0.6)',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };
export type ColorName = keyof Palette;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const MaxContentWidth = 640;
