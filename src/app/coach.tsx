import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { weekSpan } from '@/components/coach-cards';
import { chatStyles, InputBar, KeyForm, Messages, useCoachSender, type CoachSender } from '@/components/coach-chat';
import { Segmented } from '@/components/segmented';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { toast } from '@/components/toast';
import { Radius, Spacing } from '@/constants/theme';
import { ApplyError, applyCoachProposal, clearCoachChat, getCoachChat, getCoachHome, setCoachNotes, undoCoachProposal, updateCoachProfile } from '@/db/coach';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { lastWeek, PROFILE_FIELDS, type CoachProposal, type CoachWeek } from '@/lib/coach';
import type { DateKey } from '@/lib/dates';
import { coachFailure, forgetCoachKey, useCoachKey } from '@/services/coach';
import { ensureWeek } from '@/services/coach-work';
import { haptics } from '@/services/haptics';

/** Questions to start from, when the conversation is empty. */
const STARTERS = [
  { label: 'Conoscimi', text: 'Voglio che tu mi conosca bene. Fammi le domande che ti servono, una alla volta.' },
  { label: 'Com’è andata la settimana?', text: 'Analizza la mia ultima settimana: alimentazione, allenamenti, peso e integratori. Cosa va e cosa cambio?' },
  { label: 'Come va la scheda?', text: 'Guarda la mia scheda e gli ultimi allenamenti: sto progredendo? Cosa cambieresti?' },
  { label: 'Cosa mangio oggi?', text: 'Guardando cosa ho mangiato oggi, cosa mi conviene mangiare nel resto della giornata?' },
];

type Tab = 'you' | 'week' | 'chat';

/**
 * The personal coach, in three parts: who the user is (a card with fixed fields), the analysis of
 * each week with changes that apply by themselves, and the conversation for the rest.
 */
export default function CoachScreen() {
  const { key } = useCoachKey();
  return key ? <Coach /> : <KeyForm />;
}

function Coach() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'week' || params.tab === 'you' ? params.tab : 'chat');
  const sender = useCoachSender(today);

  const restart = () =>
    Alert.alert('Nuova conversazione?', 'I messaggi spariscono. La tua scheda e le analisi restano.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Ricomincia', style: 'destructive', onPress: () => void clearCoachChat(db) },
    ]);

  const leave = () =>
    Alert.alert('Togliere la chiave?', 'Il coach smette di rispondere finché non ne incolli una.', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Togli', style: 'destructive', onPress: forgetCoachKey },
    ]);

  const askInChat = (text: string) => {
    setTab('chat');
    void sender.send(text);
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={restart}>
            Nuova conversazione
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="key" destructive onPress={leave}>
            Togli la chiave di Gemini
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <View style={styles.tabs}>
        <Segmented
          options={[
            { key: 'you', label: 'Tu' },
            { key: 'week', label: 'Analisi' },
            { key: 'chat', label: 'Chat' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      {tab === 'you' ? <YouTab onAsk={askInChat} /> : tab === 'week' ? <WeekTab today={today} /> : <Chat sender={sender} />}
    </View>
  );
}

// ---------- Tu

/** The user's card: the fields the coach filled, the ones still missing, and the rest it keeps. */
function YouTab({ onAsk }: { onAsk: (text: string) => void }) {
  const db = useSQLiteContext();
  const { data } = useLiveQuery('coach-home', getCoachHome, ['settings']);
  if (!data) return null;
  const filled = PROFILE_FIELDS.filter((f) => data.profile[f.key]);
  const missing = PROFILE_FIELDS.filter((f) => !data.profile[f.key]);

  const edit = (field: (typeof PROFILE_FIELDS)[number]) =>
    Alert.prompt(
      field.label,
      'Vuoto per toglierlo.',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Salva', onPress: (value?: string) => void updateCoachProfile(db, { [field.key]: value ?? null }) },
      ],
      'plain-text',
      data.profile[field.key],
    );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {filled.length > 0 ? (
        <>
          <SectionTitle>La tua scheda</SectionTitle>
          <ListGroup>
            {filled.map((f) => (
              <Row key={f.key} title={f.label} subtitle={data.profile[f.key]} onPress={() => edit(f)} />
            ))}
          </ListGroup>
          <SectionFooter>Il coach la legge prima di ogni risposta e la aggiorna quando gli racconti qualcosa. Tocca una riga per correggerla.</SectionFooter>
        </>
      ) : null}
      {missing.length > 0 ? (
        <>
          <SectionTitle>Manca ancora</SectionTitle>
          <ListGroup>
            {missing.map((f) => (
              <Row
                key={f.key}
                title={f.label}
                subtitle={f.ask}
                detail={<AppText tone="accent">Rispondi</AppText>}
                onPress={() => onAsk(`Fammi qualche domanda su: ${f.label.toLowerCase()} (${f.ask}). Una alla volta.`)}
              />
            ))}
          </ListGroup>
          <SectionFooter>«Rispondi» apre la chat: il coach ti fa le domande e riempie la riga.</SectionFooter>
        </>
      ) : null}
      {data.notes.length > 0 ? (
        <>
          <SectionTitle>Altro che sa di te</SectionTitle>
          <ListGroup>
            {data.notes.map((note, i) => (
              <SwipeToDelete key={`${note.at}-${i}`} onDelete={() => void setCoachNotes(db, data.notes.filter((_, j) => j !== i))}>
                <Row title={note.text} />
              </SwipeToDelete>
            ))}
          </ListGroup>
          <SectionFooter>Scorri a sinistra per togliere quello che non è vero.</SectionFooter>
        </>
      ) : null}
    </ScrollView>
  );
}

// ---------- Analisi

/** Every week the coach looked at, newest first, with the changes it proposes. */
function WeekTab({ today }: { today: DateKey }) {
  const db = useSQLiteContext();
  const { data } = useLiveQuery('coach-home', getCoachHome, ['settings']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return null;
  const { from } = lastWeek(today);
  const has = data.weeks.some((w) => w.from === from);

  const analyse = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureWeek(db, today, true);
      haptics.success();
    } catch (e) {
      setError(coachFailure(e));
      haptics.error();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {!has ? (
        <View style={styles.block}>
          <AppText tone="textSecondary">Ogni lunedì il coach guarda la settimana prima: cibo, allenamenti, peso, e propone dei cambi che puoi applicare con un tocco.</AppText>
          <Button title="Analizza la settimana scorsa" onPress={() => void analyse()} loading={busy} />
        </View>
      ) : null}
      {error ? (
        <AppText variant="footnote" tone="danger">
          {error}
        </AppText>
      ) : null}
      {data.weeks.map((week) => (
        <WeekDetail key={week.from} week={week} />
      ))}
      {has ? <Button title="Rifai l’analisi della settimana scorsa" variant="plain" onPress={() => void analyse()} loading={busy} /> : null}
    </ScrollView>
  );
}

function WeekDetail({ week }: { week: CoachWeek }) {
  const theme = useTheme();
  const parts = [
    { label: 'Alimentazione', text: week.food },
    { label: 'Allenamento', text: week.training },
    { label: 'Peso', text: week.weight },
  ].filter((p) => p.text);
  return (
    <View style={styles.block}>
      <SectionTitle>{weekSpan(week)}</SectionTitle>
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        {parts.map((p) => (
          <View key={p.label} style={styles.part}>
            <AppText variant="footnote" weight="600" tone="textSecondary">
              {p.label.toUpperCase()}
            </AppText>
            <AppText variant="subhead">{p.text}</AppText>
          </View>
        ))}
      </View>
      {week.proposals.length > 0 ? (
        <>
          <SectionTitle>Proposte</SectionTitle>
          <ListGroup>
            {week.proposals.map((p) => (
              <ProposalRow key={p.id} week={week} proposal={p} />
            ))}
          </ListGroup>
          <SectionFooter>«Applica» cambia davvero gli obiettivi o la scheda; «Annulla» rimette com’era.</SectionFooter>
        </>
      ) : null}
    </View>
  );
}

function ProposalRow({ week, proposal }: { week: CoachWeek; proposal: CoachProposal }) {
  const db = useSQLiteContext();
  const [busy, setBusy] = useState(false);
  const applied = proposal.applied !== null;

  const toggle = async () => {
    setBusy(true);
    try {
      if (applied) {
        await undoCoachProposal(db, week.from, proposal.id);
        toast.show('Rimesso com’era', 'arrow.uturn.backward');
      } else {
        await applyCoachProposal(db, week.from, proposal.id);
        haptics.success();
        toast.show(proposal.title, 'checkmark.circle.fill');
      }
    } catch (e) {
      haptics.error();
      Alert.alert('Non si può applicare', e instanceof ApplyError ? e.message : 'Qualcosa non è andato, riprova.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.proposal}>
      <View style={styles.flex}>
        <AppText>{proposal.title}</AppText>
        <AppText variant="footnote" tone="textSecondary">
          {proposal.detail}
        </AppText>
      </View>
      <Button title={applied ? 'Annulla' : 'Applica'} variant={applied ? 'plain' : 'tinted'} compact loading={busy} onPress={() => void toggle()} />
    </View>
  );
}

// ---------- Chat

function Chat({ sender }: { sender: CoachSender }) {
  const theme = useTheme();
  const { model } = useCoachKey();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const insets = useSafeAreaInsets();
  // The keyboard as it moves, frame by frame, also while it is dragged down. The sheet reaches the
  // bottom of the screen, so the bar rises by the whole keyboard. Nothing is measured: inside a
  // sheet both KeyboardAvoidingView and measureInWindow read the layout from the sheet's own top,
  // not the screen's, and come out short by the gap above the sheet.
  const keyboard = useAnimatedKeyboard();
  const bottom = insets.bottom;
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value, bottom) }));
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => scroll.current?.scrollToEnd({ animated: true }));
    return () => shown.remove();
  }, []);
  const { data } = useLiveQuery('coach-chat', getCoachChat, ['settings']);
  const messages = data?.messages ?? [];
  const empty = messages.length === 0 && !sender.pending;

  return (
    <Animated.View style={[styles.flex, lift]}>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={chatStyles.messages}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {empty ? (
          <View style={styles.empty}>
            <AppText variant="title3">Ciao, sono il tuo coach</AppText>
            <AppText tone="textSecondary">
              Vedo il diario delle ultime due settimane, gli allenamenti dell’ultimo mese con i carichi, il peso, la scheda, gli integratori e il calendario. Quello che mi racconti di te lo scrivo nella tua scheda, in «Tu».
            </AppText>
            <View style={styles.starters}>
              {STARTERS.map((s) => (
                <Pressable
                  key={s.label}
                  onPress={() => void sender.send(s.text)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.starter, { backgroundColor: theme.card }, pressed && { backgroundColor: theme.cardPressed }]}>
                  <AppText variant="callout">{s.label}</AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <Messages messages={messages} sender={sender} model={model} />
        )}
      </ScrollView>
      <InputBar sender={sender} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  page: { padding: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },
  block: { gap: Spacing.sm },
  card: { borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.lg, gap: Spacing.md },
  part: { gap: 2 },
  proposal: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  empty: { gap: Spacing.md, paddingTop: Spacing.lg },
  starters: { gap: Spacing.sm, marginTop: Spacing.sm },
  starter: { borderRadius: Radius.lg, borderCurve: 'continuous', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
});
