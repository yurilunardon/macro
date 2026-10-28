import { useRouter } from 'expo-router';

import { LabelScanner } from '@/components/label-scanner';

export default function SettingsLabelScreen() {
  const router = useRouter();
  return <LabelScanner onDone={() => router.back()} />;
}
