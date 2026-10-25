import { useRouter } from 'expo-router';

import { LabelScanner } from '@/components/label-scanner';

export default function AddLabelScreen() {
  const router = useRouter();
  return <LabelScanner onDone={() => router.back()} />;
}
