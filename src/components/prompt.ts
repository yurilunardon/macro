import { Alert, Platform } from 'react-native';

import { parseDecimal } from '@/lib/format';

type PromptNumberOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Accepted range; values outside it show an error instead of calling onSubmit. */
  min: number;
  max: number;
  onSubmit: (value: number) => void;
};

/** Native iOS dialog asking for a decimal number. */
export function promptNumber({
  title,
  message,
  defaultValue = '',
  confirmLabel = 'Salva',
  min,
  max,
  onSubmit,
}: PromptNumberOptions): void {
  if (Platform.OS !== 'ios') {
    Alert.alert(title, 'Disponibile solo su iPhone.');
    return;
  }
  Alert.prompt(
    title,
    message,
    [
      { text: 'Annulla', style: 'cancel' },
      {
        text: confirmLabel,
        onPress: (text?: string) => {
          const value = parseDecimal(text ?? '');
          if (value === null || value < min || value > max) {
            Alert.alert('Valore non valido', `Inserisci un numero tra ${min} e ${max}.`);
            return;
          }
          onSubmit(value);
        },
      },
    ],
    'plain-text',
    defaultValue,
    'decimal-pad',
  );
}
