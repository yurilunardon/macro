import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { toast } from '@/components/toast';
import { pickBackup, restoreBackup, shareBackup } from '@/db/backup';
import { exportBodyCsv, exportDiaryCsv } from '@/db/export';
import { useLiveQuery } from '@/db/live';
import { getSetting, setSetting } from '@/db/settings';
import { useAppExpiry } from '@/hooks/use-app-expiry';
import { BackupFormatError } from '@/lib/backup';
import { formatExpiry } from '@/lib/provisioning';
import { haptics } from '@/services/haptics';

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
  const [busy, setBusy] = useState<'export' | 'import' | 'csv' | null>(null);
  const expiry = useAppExpiry();

  const { data } = useLiveQuery('settings', async (database) => {
    const [lastBackupAt, tabBarStyle, counts] = await Promise.all([
      getSetting(database, 'lastBackupAt'),
      getSetting(database, 'tabBarStyle'),
      database.getFirstAsync<{ entries: number; foods: number; recipes: number; meals: number }>(
        `SELECT (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM foods) AS foods,
           (SELECT COUNT(*) FROM recipes) AS recipes, (SELECT COUNT(*) FROM saved_meals) AS meals`,
      ),
    ]);
    return { lastBackupAt, tabBarStyle, counts };
  }, ['food', 'settings']);

  const status = backupStatus(data?.lastBackupAt ?? null);

  const exportCsv = async (which: 'diary' | 'body') => {
    setBusy('csv');
    try {
      const result = which === 'diary' ? await exportDiaryCsv(db) : await exportBodyCsv(db);
      if (result === 'unavailable') Alert.alert('Condivisione non disponibile su questo dispositivo.');
    } catch {
      Alert.alert('Esportazione non riuscita', 'Riprova tra un momento.');
    } finally {
      setBusy(null);
    }
  };

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
                haptics.success();
                toast.show('Backup ripristinato');
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

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Chiudi" onPress={() => router.back()} />
      </Stack.Toolbar>

      <SectionTitle>Barra in basso</SectionTitle>
      <Segmented
        options={[
          { key: 'capsule', label: 'Capsula' },
          { key: 'circles', label: 'Tre cerchi' },
          { key: 'fab', label: 'Separato' },
        ]}
        value={data?.tabBarStyle ?? 'capsule'}
        onChange={(value) => void setSetting(db, 'tabBarStyle', value)}
      />
      <SectionFooter>Il calendario è sempre il cerchio verde con la data di oggi.</SectionFooter>

      <SectionTitle>Notifiche</SectionTitle>
      <ListGroup>
        <Row
          title="Promemoria"
          subtitle="Integratori, pesata, pasti, scadenza"
          icon={<Icon name="bell.fill" size={20} tone="accent" />}
          onPress={() => router.push('/settings/reminders')}
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
        <Row
          title="Diario in CSV"
          subtitle="Per Excel o Numbers"
          icon={<Icon name="tablecells" size={20} tone="accent" />}
          detail={busy === 'csv' ? <ActivityIndicator /> : undefined}
          onPress={busy ? undefined : () => void exportCsv('diary')}
          chevron={false}
        />
        <Row
          title="Peso e misure in CSV"
          icon={<Icon name="tablecells" size={20} tone="accent" />}
          onPress={busy ? undefined : () => void exportCsv('body')}
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
        {expiry ? (
          <Row
            title="Scadenza dell’app"
            subtitle={expiry.level === 'ok' ? 'Rinnova da AltStore prima di questa data' : 'Rinnova da AltStore: My Apps → Refresh All'}
            detail={formatExpiry(expiry.expiresAt)}
            icon={
              <Icon
                name="clock.badge.exclamationmark"
                size={20}
                tone={expiry.level === 'ok' ? 'accent' : expiry.level === 'soon' ? 'warning' : 'danger'}
              />
            }
          />
        ) : null}
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
        {Updates.createdAt && !Updates.isEmbeddedLaunch ? (
          <Row
            title="Ultimo aggiornamento"
            detail={Updates.createdAt.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          />
        ) : null}
      </ListGroup>
    </ScreenScroll>
  );
}
