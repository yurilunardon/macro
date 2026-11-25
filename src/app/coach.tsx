import { useHeaderHeight } from 'expo-router/react-navigation';
import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { addCoachMessages, addCoachNotes, clearCoachChat, getCoachChat, getCoachSnapshot } from '@/db/coach';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { CHAT_SENT, newNotes, parseReply, systemPrompt, type CoachMessage } from '@/lib/coach';
import { coachFailure, askCoach, forgetCoachKey, saveCoachKey, useCoachKey } from '@/services/coach';
import { haptics } from '@/services/haptics';

/** Questions to start from, when the conversation is empty. */
const STARTERS = [
  { label: 'Conoscimi', text: 'Voglio che tu mi conosca bene. Fammi le domande che ti servono, una alla volta.' },
  { label: 'Com’è andata la settimana?', text: 'Analizza la mia ultima settimana: alimentazione, allenamenti, peso e integratori. Cosa va e cosa cambio?' },
  { label: 'Come va la scheda?', text: 'Guarda la mia scheda e gli ultimi allenamenti: sto progredendo? Cosa cambieresti?' },
  { label: 'Cosa mangio oggi?', text: 'Guardando cosa ho mangiato oggi, cosa mi conviene mangiare nel resto della giornata?' },
];

/** The personal coach: a conversation that knows the diary, the workouts and what it learned about the user. */
export default function CoachScreen() {
  const key = useCoachKey();
  return key.key ? <Chat model={key.model} /> : <KeyForm />;
}

function KeyForm() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveCoachKey(value);
      haptics.success();
    } catch (e) {
      setError(coachFailure(e));
      haptics.error();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <AppText variant="title2">Il tuo coach</AppText>
      <AppText tone="textSecondary">
        Risponde con Gemini di Google, sapendo cosa mangi, come ti alleni, il peso e gli integratori, e tiene a mente quello che gli racconti di te.
      </AppText>
      <SectionTitle>1 · Crea la chiave</SectionTitle>
      <ListGroup>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://aistudio.google.com/apikey')} style={styles.linkRow}>
          <Icon name="key.fill" size={18} tone="accent" />
          <AppText tone="accent" style={styles.flex}>
            Apri Google AI Studio
          </AppText>
          <Icon name="arrow.up.right" size={13} tone="textTertiary" />
        </Pressable>
      </ListGroup>
      <SectionFooter>Accedi con Google, tocca «Create API key» e copiala. È gratis, nei limiti del piano gratuito.</SectionFooter>
      <SectionTitle>2 · Incollala qui</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Chiave"
          value={value}
          onChangeText={setValue}
          placeholder="AIza…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
      </ListGroup>
      <SectionFooter>{error ?? 'Resta solo su questo telefono: non va nel backup né online.'}</SectionFooter>
      <Button title="Salva" onPress={() => void submit()} loading={busy} disabled={!value.trim()} />
    </ScrollView>
  );
}

function Chat({ model }: { model: string | null }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const header = useHeaderHeight();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown at once, before it is written: the conversation must not wait for the database.
  const [pending, setPending] = useState<CoachMessage | null>(null);
  const { data } = useLiveQuery('coach-chat', getCoachChat, ['settings']);
  const messages = data?.messages ?? [];

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || waiting) return;
    const question: CoachMessage = { role: 'user', text: trimmed, at: new Date().toISOString() };
    setDraft('');
    setError(null);
    setPending(question);
    setWaiting(true);
    haptics.selection();
    try {
      const snapshot = await getCoachSnapshot(db, today);
      const history = [...messages, question].slice(-CHAT_SENT);
      // The conversation starts with a question: one the model asked first is left out.
      while (history.length > 0 && history[0].role !== 'user') history.shift();
      const reply = parseReply(await askCoach(systemPrompt(snapshot), history));
      await addCoachMessages(db, [question, { role: 'model', text: reply.text, at: new Date().toISOString() }]);
      await addCoachNotes(db, newNotes(snapshot.notes, reply.notes));
      haptics.success();
    } catch (e) {
      setError(coachFailure(e));
      setDraft(trimmed);
      haptics.error();
    } finally {
      setPending(null);
      setWaiting(false);
    }
  };

  const restart = () =>
    Alert.alert('Nuova conversazione?', 'I messaggi spariscono. Quello che il coach sa di te resta.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Ricomincia', style: 'destructive', onPress: () => void clearCoachChat(db) },
    ]);

  const leave = () =>
    Alert.alert('Togliere la chiave?', 'Il coach smette di rispondere finché non ne incolli una.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Togli', style: 'destructive', onPress: forgetCoachKey },
    ]);

  const shown = pending ? [...messages, pending] : messages;

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={header} style={[styles.flex, { backgroundColor: theme.background }]}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="person.text.rectangle" onPress={() => router.push('/coach-notes')}>
            Cosa sa di te
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={restart}>
            Nuova conversazione
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="key" destructive onPress={leave}>
            Togli la chiave di Gemini
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.messages}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {shown.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="title3">Ciao, sono il tuo coach</AppText>
            <AppText tone="textSecondary">
              Vedo il diario delle ultime due settimane, gli allenamenti dell’ultimo mese con i carichi, il peso, la scheda, gli integratori e il calendario. Quello che mi racconti di te lo tengo a mente.
            </AppText>
            <View style={styles.starters}>
              {STARTERS.map((s) => (
                <Pressable
                  key={s.label}
                  onPress={() => void send(s.text)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.starter, { backgroundColor: theme.card }, pressed && { backgroundColor: theme.cardPressed }]}>
                  <AppText variant="callout">{s.label}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          shown.map((m, i) => <Bubble key={`${m.at}-${i}`} message={m} />)
        )}
        {waiting ? (
          <View style={[styles.bubble, styles.modelBubble, { backgroundColor: theme.card }]}>
            <ActivityIndicator />
          </View>
        ) : null}
        {error ? (
          <AppText variant="footnote" tone="danger" align="center">
            {error}
          </AppText>
        ) : null}
        {model && shown.length > 0 ? (
          <AppText variant="caption" tone="textTertiary" align="center">
            {model}
          </AppText>
        ) : null}
      </ScrollView>
      <View style={[styles.inputBar, { borderTopColor: theme.separator, backgroundColor: theme.background }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Scrivi al coach"
          placeholderTextColor={theme.textTertiary}
          multiline
          style={[styles.input, { backgroundColor: theme.card, color: theme.text }]}
          accessibilityLabel="Messaggio al coach"
        />
        <Pressable
          onPress={() => void send(draft)}
          disabled={!draft.trim() || waiting}
          accessibilityRole="button"
          accessibilityLabel="Invia"
          hitSlop={8}
          style={[styles.send, { backgroundColor: draft.trim() && !waiting ? theme.accent : theme.fill }]}>
          <Icon name="arrow.up" size={17} weight="bold" color={draft.trim() && !waiting ? theme.onAccent : theme.textTertiary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** A message: the user's on the right in the accent colour, the coach's on the left on a card. */
function Bubble({ message }: { message: CoachMessage }) {
  const theme = useTheme();
  const mine = message.role === 'user';
  return (
    <View style={[styles.bubble, mine ? [styles.userBubble, { backgroundColor: theme.accent }] : [styles.modelBubble, { backgroundColor: theme.card }]]}>
      {mine ? (
        <AppText style={{ color: theme.onAccent }}>{message.text}</AppText>
      ) : (
        <Markdown text={message.text} />
      )}
    </View>
  );
}

/** The little markdown the model writes: **bold**, lists and headings, nothing else. */
function Markdown({ text }: { text: string }) {
  return (
    <View style={styles.markdown}>
      {text.split('\n').map((raw, i) => {
        const line = raw.trimEnd();
        if (line.trim() === '') return <View key={i} style={styles.gap} />;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
        const body = heading?.[1] ?? bullet?.[1] ?? line;
        const number = /^\s*(\d+)[.)]\s/.exec(line)?.[1];
        return (
          <View key={i} style={bullet ? styles.bulletRow : undefined}>
            {bullet ? <AppText>{number ? `${number}.` : '•'}</AppText> : null}
            <AppText weight={heading ? '600' : undefined} style={bullet ? styles.flex : undefined}>
              {body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
                part.startsWith('**') && part.endsWith('**') ? (
                  <AppText key={j} weight="600">
                    {part.slice(2, -2)}
                  </AppText>
                ) : (
                  part.replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
                ),
              )}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: Spacing.lg, gap: Spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 48 },
  messages: { padding: Spacing.lg, gap: Spacing.sm },
  empty: { gap: Spacing.md, paddingTop: Spacing.lg },
  starters: { gap: Spacing.sm, marginTop: Spacing.sm },
  starter: { borderRadius: Radius.lg, borderCurve: 'continuous', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  bubble: { maxWidth: '86%', borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { alignSelf: 'flex-end' },
  modelBubble: { alignSelf: 'flex-start' },
  markdown: { gap: 2 },
  gap: { height: 6 },
  bulletRow: { flexDirection: 'row', gap: 6 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, minHeight: 38, maxHeight: 140, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 16 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
});
