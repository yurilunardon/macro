import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Stack, useIsFocused } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LabelReader from '../../modules/label-reader';
import { Radius, Spacing } from '@/constants/theme';
import { labelScan } from '@/hooks/use-label-scan';
import { useTheme } from '@/hooks/use-theme';
import { countFound, parseNutritionLabel } from '@/lib/label-parser';

import { AppText } from './app-text';
import { Button } from './button';
import { Icon } from './icon';

/** Whether this build can read text from photos (not in Expo Go). */
export const canReadLabels = LabelReader !== null;

/**
 * Takes a photo of a nutrition label, reads it on the device and hands the values to the food
 * form through `labelScan`. Calls `onDone` when there is something to use.
 */
export function LabelScanner({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);

  const header = (
    <Stack.Screen
      options={
        permission?.granted && LabelReader
          ? { headerTintColor: '#FFFFFF', headerTitleStyle: { color: '#FFFFFF' } }
          : { headerTintColor: theme.accent, headerTitleStyle: { color: theme.text } }
      }
    />
  );

  if (!LabelReader) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.background, paddingTop: insets.top + 60 }]}>
        {header}
        <Icon name="text.viewfinder" size={44} tone="textSecondary" />
        <AppText variant="title2" align="center">
          Non disponibile qui
        </AppText>
        <AppText tone="textSecondary" align="center">
          La lettura delle etichette funziona nell’app installata con AltStore, non in Expo Go.
        </AppText>
      </View>
    );
  }

  if (!permission?.granted) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.background, paddingTop: insets.top + 60 }]}>
        {header}
        <Icon name="camera.fill" size={44} tone="textSecondary" />
        <AppText variant="title2" align="center">
          Serve la fotocamera
        </AppText>
        <AppText tone="textSecondary" align="center">
          La foto resta sul telefono: il testo viene letto dall’iPhone, senza internet.
        </AppText>
        <View style={styles.permissionButton}>
          {permission?.canAskAgain !== false ? (
            <Button title="Consenti fotocamera" onPress={() => void requestPermission()} />
          ) : (
            <Button title="Apri Impostazioni" onPress={() => void Linking.openSettings()} />
          )}
        </View>
      </View>
    );
  }

  const capture = async () => {
    const reader = LabelReader;
    if (!reader || !camera.current || reading) return;
    setReading(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, shutterSound: false });
      const boxes = await reader.recognizeText(photo.uri);
      const values = parseNutritionLabel(boxes);
      if (countFound(values) < 2) {
        Alert.alert(
          'Tabella non trovata',
          'Inquadra solo la tabella nutrizionale, dritta e con buona luce, e riprova.',
        );
        return;
      }
      labelScan.set(values);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch {
      Alert.alert('Lettura non riuscita', 'Riprova la foto.');
    } finally {
      setReading(false);
    }
  };

  return (
    <View style={[styles.fill, styles.black]}>
      {header}
      {focused ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        <View style={styles.frame} />
        <AppText variant="callout" weight="600" align="center" style={styles.hint}>
          Inquadra la tabella nutrizionale
        </AppText>
      </View>
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <Pressable
          onPress={() => void capture()}
          disabled={!ready || reading}
          accessibilityRole="button"
          accessibilityLabel="Scatta e leggi l’etichetta"
          style={({ pressed }) => [styles.shutter, (pressed || !ready) && styles.dimmed]}>
          {reading ? <ActivityIndicator color="#000000" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  black: { backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  permissionButton: { alignSelf: 'stretch', paddingTop: Spacing.lg },
  frame: {
    width: '86%',
    aspectRatio: 0.8,
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
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: '#000000' },
  dimmed: { opacity: 0.6 },
});
