import { requireOptionalNativeModule } from 'expo';

type RestActivityModule = {
  isEnabled(): boolean;
  /** Times in milliseconds since 1970. Starts the activity, or changes the one there is. */
  show(title: string, label: string, startedAt: number, endsAt: number): void;
  hide(): void;
};

/**
 * The rest on the Lock Screen and in the Dynamic Island. Null where there is none: on the web,
 * and in builds made before it, which an update can still reach.
 */
export const RestActivity = requireOptionalNativeModule<RestActivityModule>('RestActivity');
