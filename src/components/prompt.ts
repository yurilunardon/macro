import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { parseDecimal } from '@/lib/format';

type PromptNumberOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** Accepted range; values outside it show an error instead of calling onSubmit. */
  min: number;
  max: number;
} & (
  | { allowEmpty?: false; onSubmit: (value: number) => void }
  /** An empty answer calls onSubmit with null, for clearing a value. */
  | { allowEmpty: true; onSubmit: (value: number | null) => void }
);

/** Native iOS dialog asking for a decimal number. */
export function promptNumber(options: PromptNumberOptions): void {
  const { title, message, defaultValue = '', confirmLabel = 'Salva', min, max } = options;
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
          if (options.allowEmpty && (text ?? '').trim() === '') {
            options.onSubmit(null);
            return;
          }
          const value = parseDecimal(text ?? '');
          if (value === null || value < min || value > max) {
            Alert.alert('Valore non valido', `Inserisci un numero tra ${min} e ${max}.`);
            return;
          }
          options.onSubmit(value);
        },
      },
    ],
    'plain-text',
    defaultValue,
    'decimal-pad',
  );
}

type ConfirmOptions = {
  title: string;
  message?: string;
  /** The destructive button, e.g. "Elimina" or "Svuota". */
  action: string;
};

/**
 * Confirmation before something that cannot be undone. On iPhone it is the sheet that rises
 * from the bottom, as when deleting in Apple's apps, rather than an alert in the middle of the
 * screen. Resolves to whether to go ahead.
 */
export function confirmDestructive({ title, message, action }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, message, options: [action, 'Annulla'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (index) => resolve(index === 0),
      );
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: 'Annulla', style: 'cancel', onPress: () => resolve(false) },
        { text: action, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
