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

type ChooseOptions = {
  title: string;
  message?: string;
  /** The choices, top to bottom; "Annulla" is added at the end. */
  actions: readonly { label: string; destructive?: boolean }[];
};

/** The sheet from the bottom with a few choices. Resolves to the index chosen, null for "Annulla". */
export function choose({ title, message, actions }: ChooseOptions): Promise<number | null> {
  return new Promise((resolve) => {
    const destructive = actions.findIndex((a) => a.destructive);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          options: [...actions.map((a) => a.label), 'Annulla'],
          destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
          cancelButtonIndex: actions.length,
        },
        (index) => resolve(index < actions.length ? index : null),
      );
      return;
    }
    Alert.alert(
      title,
      message,
      [
        ...actions.map((a, index) => ({
          text: a.label,
          style: a.destructive ? ('destructive' as const) : ('default' as const),
          onPress: () => resolve(index),
        })),
        { text: 'Annulla', style: 'cancel' as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/** A text to change in a prompt, with "Elimina" beside "Salva" when there is one. */
export function editText({ title, message, value, onSave }: { title: string; message: string; value: string | null; onSave: (text: string) => void }) {
  Alert.prompt(
    title,
    message,
    [
      { text: 'Annulla', style: 'cancel' },
      ...(value ? [{ text: 'Elimina', style: 'destructive' as const, onPress: () => onSave('') }] : []),
      { text: 'Salva', isPreferred: true, onPress: (text?: string) => onSave(text ?? '') },
    ],
    'plain-text',
    value ?? '',
  );
}
