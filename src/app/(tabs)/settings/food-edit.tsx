import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { FoodForm } from '@/components/food-form';

export default function FoodEditScreen() {
  const router = useRouter();
  const { foodId } = useLocalSearchParams<{ foodId?: string }>();
  const id = foodId ? Number(foodId) : NaN;
  const editing = Number.isInteger(id) && id > 0;

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Correggi alimento' : 'Nuovo alimento' }} />
      <FoodForm foodId={editing ? id : null} onSaved={() => router.back()} />
    </>
  );
}
