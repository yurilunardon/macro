import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { restoreBackup } from '@/db/backup';
import { CLOUD_EVERY_MS, CLOUD_KEEP, formatBytes, formatCloudTime } from '@/lib/cloud';
import { haptics } from '@/services/haptics';
import {
  cloudFailure,
  downloadCopy,
  listCopies,
  restoredFromCloud,
  saveNow,
  signIn,
  signOut,
  useCloudBackup,
  type CloudCopy,
} from '@/services/cloud-backup';

/** The copy of the data in the user's Supabase: signing in once, how the last save went, the copies. */
export default function CloudScreen() {
  const cloud = useCloudBackup();
  return cloud.session ? <SignedIn /> : <SignInForm />;
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloud = useCloudBackup();

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const { copies } = await signIn(email, password);
      haptics.success();
      toast.show(copies > 0 ? 'Accesso fatto: ci sono copie online' : 'Accesso fatto', 'icloud.fill');
    } catch (e) {
      setError(cloudFailure(e));
      haptics.error();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScroll>
      <SectionTitle>Account Supabase</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="nome@esempio.it"
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />
        <FieldRow
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Obbligatoria"
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      </ListGroup>
      <SectionFooter>
        {error ?? cloud.error ?? 'L’utente che hai creato nel tuo progetto Supabase. Lo chiede una volta sola, e la password non resta sul telefono.'}
      </SectionFooter>
      <View style={styles.actions}>
        <Button title="Accedi" onPress={() => void submit()} loading={busy} disabled={!email.trim() || !password} />
      </View>
    </ScreenScroll>
  );
}

function SignedIn() {
  const db = useSQLiteContext();
  const cloud = useCloudBackup();
  const [copies, setCopies] = useState<CloudCopy[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  // Tapped after a failure, it asks again.
  const [attempt, setAttempt] = useState(0);

  // Again after each save, which adds or replaces today's.
  useEffect(() => {
    let cancelled = false;
    listCopies().then(
      (list) => {
        if (cancelled) return;
        setCopies(list);
        setListError(null);
      },
      (e: unknown) => {
        if (!cancelled) setListError(cloudFailure(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, cloud.savedAt]);

  const save = async () => {
    try {
      await saveNow(db);
      haptics.success();
      toast.show('Copia salvata online', 'icloud.and.arrow.up');
    } catch {
      haptics.error();
    }
  };

  const restore = async (copy: CloudCopy) => {
    setOpening(copy.name);
    try {
      const backup = await downloadCopy(copy);
      Alert.alert(
        'Sostituire tutti i dati?',
        `Copia di ${formatCloudTime(copy.updatedAt)}\n${backup.entries.length} voci di diario, ${backup.workouts.length} allenamenti, ${backup.weights.length} pesate.\n\nI dati attuali del telefono verranno cancellati.`,
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Ripristina',
            style: 'destructive',
            onPress: async () => {
              try {
                await restoreBackup(db, backup);
                restoredFromCloud();
                haptics.success();
                toast.show('Copia ripristinata');
              } catch {
                Alert.alert('Ripristino non riuscito', 'I dati del telefono non sono stati modificati.');
              }
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Copia non leggibile', cloudFailure(e));
    } finally {
      setOpening(null);
    }
  };

  const leave = () =>
    Alert.alert('Uscire dall’account?', 'Le copie restano online. Finché non accedi di nuovo, il telefono smette di salvarle.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: signOut },
    ]);

  return (
    <ScreenScroll>
      <ListGroup>
        <Row
          title="Ultima copia"
          detail={cloud.savedAt ? formatCloudTime(cloud.savedAt) : 'Mai da qui'}
          icon={<Icon name="icloud.fill" size={20} tone={cloud.error ? 'warning' : 'accent'} />}
        />
        {cloud.error ? (
          <Row title={cloud.error} subtitle="Riprova con «Salva ora»" icon={<Icon name="exclamationmark.triangle.fill" size={20} tone="warning" />} />
        ) : null}
        {!cloud.auto ? (
          <Row
            title="Salvataggio automatico in pausa"
            subtitle="Ripristina una copia, o salva ora"
            icon={<Icon name="pause.circle.fill" size={20} tone="warning" />}
          />
        ) : null}
        <Row
          title="Salva ora"
          icon={<Icon name="icloud.and.arrow.up" size={20} tone="accent" />}
          detail={cloud.busy ? <ActivityIndicator /> : undefined}
          onPress={cloud.busy ? undefined : () => void save()}
          chevron={false}
        />
      </ListGroup>
      <SectionFooter>
        {cloud.auto
          ? `Si salva da solo quando apri o chiudi l’app, al massimo ogni ${CLOUD_EVERY_MS / 3_600_000} ore. Una copia al giorno, le ultime ${CLOUD_KEEP}.`
          : 'Ci sono già copie online e il telefono non sa se le sue sono più recenti: non le sovrascrive finché non ripristini una copia o salvi tu.'}
      </SectionFooter>

      <SectionTitle>Copie online</SectionTitle>
      <ListGroup>
        {copies === null && !listError ? (
          <View style={styles.loading}>
            <ActivityIndicator />
          </View>
        ) : listError ? (
          <Row title={listError} icon={<Icon name="exclamationmark.triangle.fill" size={20} tone="warning" />} onPress={() => setAttempt((n) => n + 1)} chevron={false} />
        ) : copies?.length === 0 ? (
          <Row title="Nessuna copia" subtitle="La prima arriva con «Salva ora»" />
        ) : (
          copies?.map((copy) => (
            <Row
              key={copy.name}
              title={capitalize(formatCloudTime(copy.updatedAt))}
              subtitle={formatBytes(copy.size)}
              detail={opening === copy.name ? <ActivityIndicator /> : undefined}
              onPress={opening ? undefined : () => void restore(copy)}
              accessibilityHint="Ripristina questa copia"
            />
          ))
        )}
      </ListGroup>
      <SectionFooter>Tocca una copia per rimettere sul telefono i dati di quel giorno.</SectionFooter>

      <SectionTitle>Account</SectionTitle>
      <ListGroup>
        <Row title={cloud.session?.email || 'Account Supabase'} subtitle="Le copie sono visibili solo a te" />
        <Row title="Esci" destructive onPress={leave} chevron={false} />
      </ListGroup>
    </ScreenScroll>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  actions: { paddingTop: Spacing.lg },
  loading: { paddingVertical: Spacing.lg, alignItems: 'center' },
});
