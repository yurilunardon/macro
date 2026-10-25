import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { promptNumber } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { pickBackup, restoreBackup, shareBackup } from '@/db/backup';
import { useLiveQuery } from '@/db/live';
import { DEFAULT_WATER_GOAL_ML, getSetting, getTargets, setSetting } from '@/db/settings';
import { BackupFormatError } from '@/lib/backup';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';

const BACKUP_REMINDER_DAYS = 7;

function backupStatus(lastBackupAt: string | null): { text: string; stale: boolean } {
  if (!lastBackupAt) return { text: 'Non hai ancora esportato un backup.', stale: true };
  const days = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86_400_000);
  const when = days <= 0 ? 'oggi' : days === 1 ? 'ieri' : `${days} giorni fa`;
  // The share sheet does not say whether the file was saved, so this is the last export attempt.
  return { text: `Ultima esportazione: ${when}.`, stale: days >= BACKUP_REMINDER_DAYS };
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const { data } = useLiveQuery('settings', async (database) => {
    const [goals, waterGoal, lastBackupAt, counts] = await Promise.all([
      getTargets(database),
      getSetting(database, 'waterGoalMl'),
      getSetting(database, 'lastBackupAt'),
      database.getFirstAsync<{ entries: number; foods: number }>(
        'SELECT (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM foods) AS foods',
      ),
    ]);
    return { ...goals, waterGoal: waterGoal ?? DEFAULT_WATER_GOAL_ML, lastBackupAt, counts };
  });

  const status = backupStatus(data?.lastBackupAt ?? null);

  const exportBackup = async () => {
    setBusy('export');
    try {
      const result = await shareBackup(db);
      if (result === 'unavailable') Alert.alert('Condivisione non disponibile su questo dispositivo.');
    } catch {
      Alert.alert('Backup non riuscito', 'Riprova tra un momento.');
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    setBusy('import');
    try {
      const picked = await pickBackup();
      if (!picked) return;
      const { backup, fileName } = picked;
      const exported = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('it-IT') : 'data sconosciuta';
      Alert.alert(
        'Sostituire tutti i dati?',
        `${fileName}\nCreato il ${exported}\n${backup.entries.length} voci di diario, ${backup.foods.length} alimenti, ${backup.weights.length} pesate.\n\nI dati attuali del telefono verranno cancellati.`,
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Ripristina',
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreBackup(db, backup);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Backup ripristinato');
              } catch {
                Alert.alert('Ripristino non riuscito', 'I dati del telefono non sono stati modificati.');
              }
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert(
        'File non valido',
        error instanceof BackupFormatError ? error.message : 'Non riesco a leggere questo file.',
      );
    } finally {
      setBusy(null);
    }
  };

  const editWaterGoal = () =>
    promptNumber({
      title: 'Obiettivo acqua',
      message: 'Litri al giorno.',
      defaultValue: numberToInput((data?.waterGoal ?? DEFAULT_WATER_GOAL_ML) / 1000),
      min: 0.5,
      max: 8,
      onSubmit: (liters) => void setSetting(db, 'waterGoalMl', Math.round(liters * 1000)),
    });

  return (
    <ScreenScroll>
      <SectionTitle>Obiettivi</SectionTitle>
      <ListGroup>
        <Row
          title="Calorie e macro"
          subtitle={
            data
              ? data.isDefault
                ? 'Valori di esempio: impostali per te'
                : `P ${data.targets.protein} g · C ${data.targets.carbs} g · G ${data.targets.fat} g`
              : null
          }
          detail={data ? `${formatKcal(data.targets.kcal)} kcal` : undefined}
          icon={<Icon name="target" size={20} tone="accent" />}
          onPress={() => router.push('/settings/goals')}
        />
        <Row
          title="Acqua"
          detail={data ? `${formatNumber(data.waterGoal / 1000, 1)} L` : undefined}
          icon={<Icon name="drop.fill" size={20} tone="water" />}
          onPress={editWaterGoal}
        />
      </ListGroup>

      <SectionTitle>Alimenti</SectionTitle>
      <ListGroup>
        <Row
          title="I miei alimenti"
          subtitle="Creati da te, preferiti e salvati"
          detail={data?.counts ? String(data.counts.foods) : undefined}
          icon={<Icon name="fork.knife" size={20} tone="accent" />}
          onPress={() => router.push('/settings/foods')}
        />
      </ListGroup>

      <SectionTitle>Backup</SectionTitle>
      <ListGroup>
        <Row
          title="Esporta backup"
          subtitle={status.text}
          icon={<Icon name="square.and.arrow.up" size={20} tone={status.stale ? 'warning' : 'accent'} />}
          detail={busy === 'export' ? <ActivityIndicator /> : undefined}
          onPress={busy ? undefined : () => void exportBackup()}
          chevron={false}
        />
        <Row
          title="Ripristina da un backup"
          icon={<Icon name="arrow.counterclockwise" size={20} tone="accent" />}
          detail={busy === 'import' ? <ActivityIndicator /> : undefined}
          onPress={busy ? undefined : () => void importBackup()}
          chevron={false}
        />
      </ListGroup>
      <SectionFooter>
        {`I dati restano sul telefono anche quando l’app scade e la rinnovi con AltStore. Il backup serve se elimini l’app, cambi Apple ID o cambi iPhone: scegli «Salva su File» e mettilo in iCloud Drive.${
          data?.counts ? `\n\nSul telefono: ${data.counts.entries} voci di diario, ${data.counts.foods} alimenti.` : ''
        }`}
      </SectionFooter>

      <SectionTitle>Informazioni</SectionTitle>
      <ListGroup>
        <Row
          title="Dati prodotti: Open Food Facts"
          subtitle="Database libero, licenza ODbL"
          icon={<Icon name="globe" size={20} tone="accent" />}
          onPress={() => void Linking.openURL('https://it.openfoodfacts.org')}
        />
        <Row
          title="Alimenti base: USDA FoodData Central"
          subtitle="Valori medi, pubblico dominio"
          icon={<Icon name="leaf.fill" size={20} tone="accent" />}
          onPress={() => void Linking.openURL('https://fdc.nal.usda.gov')}
        />
        <Row title="Versione" detail={Constants.expoConfig?.version ?? '—'} />
      </ListGroup>
    </ScreenScroll>
  );
}
