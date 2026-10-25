import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import type { SFSymbol } from 'expo-symbols';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useAddFlowParams } from '@/hooks/use-add-flow';
import { useTheme } from '@/hooks/use-theme';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export default function ScanScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { meal, date } = useAddFlowParams();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // The camera reports the same code many times per second: handle only the first.
  const handled = useRef(false);

  const openBarcode = (barcode: string) => {
    router.replace({ pathname: '/add/food', params: { meal, date, barcode } });
  };

  const onScanned = ({ data }: BarcodeScanningResult) => {
    const code = data.replace(/\D/g, '');
    if (handled.current || code.length < 6) return;
    handled.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    openBarcode(code);
  };

  const typeCode = () => {
    if (Platform.OS !== 'ios') return;
    Alert.prompt(
      'Inserisci il codice',
      'Le cifre sotto il codice a barre.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Cerca',
          onPress: (value?: string) => {
            const code = (value ?? '').replace(/\D/g, '');
            if (code.length >= 6) openBarcode(code);
          },
        },
      ],
      'plain-text',
      '',
      'number-pad',
    );
  };

  // White header over the camera; on the light permission screen white would be invisible.
  const header = (
    <Stack.Screen
      options={
        permission?.granted
          ? { headerTintColor: '#FFFFFF', headerTitleStyle: { color: '#FFFFFF' } }
          : { headerTintColor: theme.accent, headerTitleStyle: { color: theme.text } }
      }
    />
  );

  if (!permission) return <View style={[styles.fill, { backgroundColor: theme.background }]}>{header}</View>;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.background, paddingTop: insets.top + 60 }]}>
        {header}
        <Icon name="camera.fill" size={44} tone="textSecondary" />
        <AppText variant="title2" align="center">
          Serve la fotocamera
        </AppText>
        <AppText tone="textSecondary" align="center">
          La uso solo per leggere i codici a barre. Le immagini non vengono salvate.
        </AppText>
        <View style={styles.permissionButton}>
          {permission.canAskAgain ? (
            <Button title="Consenti fotocamera" onPress={() => void requestPermission()} />
          ) : (
            <Button title="Apri Impostazioni" onPress={() => void Linking.openSettings()} />
          )}
        </View>
        <Button title="Inserisci il codice a mano" variant="plain" onPress={typeCode} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, styles.black]}>
      {header}
      {focused ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={onScanned}
        />
      ) : null}

      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <View style={styles.frame} />
        <AppText variant="callout" weight="600" align="center" style={styles.hint}>
          Inquadra il codice a barre
        </AppText>
      </View>

      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <ControlButton
          symbol={torch ? 'flashlight.on.fill' : 'flashlight.off.fill'}
          label={torch ? 'Spegni la torcia' : 'Accendi la torcia'}
          onPress={() => setTorch((t) => !t)}
        />
        <ControlButton symbol="keyboard" label="Inserisci il codice a mano" onPress={typeCode} />
      </View>
    </View>
  );
}

function ControlButton({ symbol, label, onPress }: { symbol: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.control, pressed && { opacity: 0.7 }]}>
      <Icon name={symbol} size={22} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  black: { backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  permissionButton: { alignSelf: 'stretch', paddingTop: Spacing.lg },
  frame: {
    width: '86%',
    aspectRatio: 1.9,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  hint: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xxl,
  },
  control: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
