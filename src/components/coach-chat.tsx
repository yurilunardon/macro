/**
 * The parts of a conversation with the coach, for its screen and for the sheet it opens in from
 * the rest of the app: the bubbles, the bar to write in, the key form, and sending.
 */
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CoachMessage } from '@/lib/coach';
import type { DateKey } from '@/lib/dates';
import { coachFailure, saveCoachKey } from '@/services/coach';
import { sendToCoach } from '@/services/coach-work';
import { haptics } from '@/services/haptics';

export type CoachSender = {
  /** The question just sent, shown before it is written. */
  pending: CoachMessage | null;
  waiting: boolean;
  error: string | null;
  /** True when it went; on a failure the error says why. */
  send: (text: string, about?: { about?: string; context?: string }) => Promise<boolean>;
};

/** Sending to the coach, with what is on its way. */
export function useCoachSender(today: DateKey): CoachSender {
  const db = useSQLiteContext();
  const [pending, setPending] = useState<CoachMessage | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (text: string, about?: { about?: string; context?: string }) => {
    const trimmed = text.trim();
    if (!trimmed || waiting) return false;
    const question: CoachMessage = { role: 'user', text: trimmed, at: new Date().toISOString(), ...about };
    setError(null);
    setPending(question);
    setWaiting(true);
    haptics.selection();
    try {
      await sendToCoach(db, today, question);
      haptics.success();
      return true;
    } catch (e) {
      setError(coachFailure(e));
      haptics.error();
      return false;
    } finally {
      setPending(null);
      setWaiting(false);
    }
  };

  return { pending, waiting, error, send };
}

/** What a question is about, as a small label over it. */
export function AboutChip({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.accentSoft }]}>
      <Icon name="sparkles" size={11} tone="accent" />
      <AppText variant="footnote" weight="600" tone="accent" numberOfLines={1} style={styles.shrink}>
        {`Su: ${text}`}
      </AppText>
    </View>
  );
}

/** The messages, then the coach thinking and what went wrong. */
export function Messages({ messages, sender, model }: { messages: readonly CoachMessage[]; sender: CoachSender; model?: string | null }) {
  const theme = useTheme();
  const shown = sender.pending ? [...messages, sender.pending] : messages;
  return (
    <>
      {shown.map((m, i) => (
        <Bubble key={`${m.at}-${i}`} message={m} showAbout={m.about !== undefined && m.about !== shown[i - 2]?.about} />
      ))}
      {sender.waiting ? (
        <View style={[styles.bubble, styles.modelBubble, { backgroundColor: theme.card }]}>
          <ActivityIndicator />
        </View>
      ) : null}
      {sender.error ? (
        <AppText variant="footnote" tone="danger" align="center">
          {sender.error}
        </AppText>
      ) : null}
      {model && shown.length > 0 ? (
        <AppText variant="caption" tone="textTertiary" align="center">
          {model}
        </AppText>
      ) : null}
    </>
  );
}

/** A message: the user's on the right in the accent colour, the coach's on the left on a card. */
function Bubble({ message, showAbout }: { message: CoachMessage; showAbout: boolean }) {
  const theme = useTheme();
  const mine = message.role === 'user';
  return (
    <>
      {mine && showAbout && message.about ? (
        <View style={styles.aboutRow}>
          <AboutChip text={message.about} />
        </View>
      ) : null}
      <View style={[styles.bubble, mine ? [styles.userBubble, { backgroundColor: theme.accent }] : [styles.modelBubble, { backgroundColor: theme.card }]]}>
        {mine ? <AppText style={{ color: theme.onAccent }}>{message.text}</AppText> : <Markdown text={message.text} />}
      </View>
    </>
  );
}

/** The little markdown the model writes: **bold**, lists and headings, nothing else. */
export function Markdown({ text }: { text: string }) {
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

/** The bar to write in, with the send button. */
export function InputBar({ sender, autoFocus = false, onSent }: { sender: CoachSender; autoFocus?: boolean; onSent?: () => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');
  const ready = draft.trim() !== '' && !sender.waiting;
  const submit = async () => {
    const text = draft;
    setDraft('');
    const ok = await sender.send(text);
    if (!ok) setDraft(text);
    else onSent?.();
  };
  return (
    <View style={[styles.inputBar, { borderTopColor: theme.separator, backgroundColor: theme.background }]}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Scrivi al coach"
        placeholderTextColor={theme.textTertiary}
        multiline
        autoFocus={autoFocus}
        style={[styles.input, { backgroundColor: theme.card, color: theme.text }]}
        accessibilityLabel="Messaggio al coach"
      />
      <Pressable
        onPress={() => void submit()}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="Invia"
        hitSlop={8}
        style={[styles.send, { backgroundColor: ready ? theme.accent : theme.fill }]}>
        <Icon name="arrow.up" size={17} weight="bold" color={ready ? theme.onAccent : theme.textTertiary} />
      </Pressable>
    </View>
  );
}

/** The first time: the user makes a Gemini key and pastes it. */
export function KeyForm() {
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

export const chatStyles = StyleSheet.create({
  messages: { padding: Spacing.lg, gap: Spacing.sm },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  form: { padding: Spacing.lg, gap: Spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 48 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 26, paddingHorizontal: 10, borderRadius: 13, maxWidth: '100%' },
  aboutRow: { alignItems: 'flex-end', marginTop: Spacing.xs },
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
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, minHeight: 38, maxHeight: 140, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 16 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
});
