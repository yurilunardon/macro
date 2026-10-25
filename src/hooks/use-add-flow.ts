import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';

import { isDateKey, todayKey, type DateKey } from '@/lib/dates';
import { isMealKey, mealForTime, type MealKey } from '@/lib/meals';

type RawParams = { meal?: string; date?: string; foodId?: string; barcode?: string };

export type AddFlowParams = {
  meal: MealKey;
  date: DateKey;
  foodId: number | null;
  barcode: string | null;
};

/** Parameters shared by every screen of the "add food" modal, validated with sensible fallbacks. */
export function useAddFlowParams(): AddFlowParams {
  const raw = useLocalSearchParams<RawParams>();
  const foodId = raw.foodId ? Number(raw.foodId) : NaN;
  return {
    meal: isMealKey(raw.meal) ? raw.meal : mealForTime(),
    date: isDateKey(raw.date) ? raw.date : todayKey(),
    foodId: Number.isInteger(foodId) && foodId > 0 ? foodId : null,
    barcode: raw.barcode && /^\d{6,14}$/.test(raw.barcode) ? raw.barcode : null,
  };
}

/** Closes the whole "add food" modal, whichever of its screens is showing. */
export function useCloseAddFlow(): () => void {
  const navigation = useNavigation();
  const router = useRouter();
  return () => {
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else router.back();
  };
}
