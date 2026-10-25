import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import type { ColorName } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconProps = {
  /** SF Symbol name. */
  name: SymbolViewProps['name'];
  size?: number;
  tone?: ColorName;
  color?: string;
  weight?: SymbolViewProps['weight'];
};

export function Icon({ name, size = 20, tone = 'text', color, weight = 'medium' }: IconProps) {
  const theme = useTheme();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color ?? theme[tone]}
      weight={weight}
      style={{ width: size, height: size }}
    />
  );
}
