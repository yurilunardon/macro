import { Stack, useRouter } from 'expo-router';

import { FoodForm } from '@/components/food-form';
import { useAddFlowParams } from '@/hooks/use-add-flow';

export default function CustomFoodScreen() {
  const router = useRouter();
  const { foodId, barcode, forward } = useAddFlowParams();

  return (
    <>
      <Stack.Screen options={{ title: foodId !== null ? 'Correggi alimento' : 'Nuovo alimento' }} />
      <FoodForm
        foodId={foodId}
        initialBarcode={barcode}
        onSaved={(id, created) => {
          // A new food goes straight to choosing the quantity; an edit returns to where it came from.
          if (created) router.replace({ pathname: '/add/food', params: { ...forward, foodId: id } });
          else router.back();
        }}
      />
    </>
  );
}
