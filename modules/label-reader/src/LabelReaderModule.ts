import { NativeModule, requireOptionalNativeModule } from 'expo';

export type RecognizedText = { text: string; x: number; y: number; width: number; height: number };

declare class LabelReaderModule extends NativeModule<Record<string, never>> {
  recognizeText(uri: string): Promise<RecognizedText[]>;
}

/** Null where the native code is not included, such as Expo Go. */
export default requireOptionalNativeModule<LabelReaderModule>('LabelReader');
