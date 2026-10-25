import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal } from '@/lib/format';
import type { FoodDraft } from '@/lib/nutrition';

import { AppText } from './app-text';
import { Icon } from './icon';
import { MacroInline } from './nutrition';

const SOURCE_ICONS = { off: 'barcode', custom: 'fork.knife', generic: 'leaf.fill', recipe: 'frying.pan.fill' } as const;

type FoodRowProps = {
  food: FoodDraft & { favorite?: boolean; category?: string | null };
  onPress: () => void;
  onLongPress?: () => void;
};

/** A food in search results and lists: thumbnail, name, brand, kcal and macros per 100. */
export const FoodRow = memo(function FoodRow({ food, onPress, onLongPress }: FoodRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}, ${formatKcal(food.per100.kcal)} chilocalorie per 100 ${food.unit}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <View style={[styles.thumb, { backgroundColor: theme.track }]}>
        {food.imageUrl ? (
          <Image source={food.imageUrl} style={styles.thumbImage} contentFit="cover" recyclingKey={food.imageUrl} />
        ) : (
          <Icon name={SOURCE_ICONS[food.source]} size={18} tone="textSecondary" />
        )}
      </View>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <AppText numberOfLines={1} style={styles.name}>
            {food.name}
          </AppText>
          {food.favorite ? <Icon name="star.fill" size={12} tone="warning" /> : null}
        </View>
        <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
          {[food.brand ?? food.category, `${formatKcal(food.per100.kcal)} kcal / 100 ${food.unit}`]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
        <MacroInline totals={food.per100} />
      </View>
      <Icon name="plus.circle.fill" size={26} tone="accent" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  text: { flex: 1, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  name: { flexShrink: 1 },
});
