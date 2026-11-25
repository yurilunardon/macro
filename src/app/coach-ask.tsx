import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { AboutChip, chatStyles, InputBar, KeyForm, Messages, useCoachSender } from '@/components/coach-chat';
import { Spacing } from '@/constants/theme';
import { getCoachChat, getWorkoutForCoach } from '@/db/coach';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { workoutText } from '@/lib/coach';
import { useCoachKey } from '@/services/coach';

/**
 * The coach over what was on screen, on half of it: what it is about at the top, the answers of
 * this time only, and the bar to write in. The messages also go in the coach's conversation.
 */
export default function CoachAskSheet() {
  const { key } = useCoachKey();
  return key ? <Ask /> : <KeyForm />;
}

function Ask() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ about?: string; context?: string; question?: string; workout?: string }>();
  const about = params.about ?? 'Coach';
  const sender = useCoachSender(today);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // Only what is said from now on: the sheet is about one thing.
  const [since] = useState(() => new Date().toISOString());
  const { data } = useLiveQuery('coach-chat', getCoachChat, ['settings']);
  const messages = (data?.messages ?? []).filter((m) => m.at >= since);

  // A workout's sets go with every question of this sheet.
  const workoutId = params.workout ? Number(params.workout) : null;
  const [context, setContext] = useState<string | null>(workoutId === null ? (params.context ?? null) : null);
  useEffect(() => {
    if (workoutId === null) return;
    void getWorkoutForCoach(db, workoutId).then((w) => setContext([w ? workoutText(w) : null, params.context].filter(Boolean).join('\n') || ''));
  }, [db, workoutId, params.context]);

  // A ready question is sent at once, when its data is there.
  const asked = useRef(false);
  const ready = context !== null || workoutId === null;
  useEffect(() => {
    if (!params.question || asked.current || !ready) return;
    asked.current = true;
    void sender.send(params.question, { about, context: context ?? undefined });
  }, [params.question, ready, about, context, sender]);

  const withAbout = { ...sender, send: (text: string) => sender.send(text, { about, context: context ?? undefined }) };

  return (
    // No scroll view around the bar: in a sheet the keyboard lifts the whole sheet.
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <AppText variant="title3" style={styles.flex}>
          Coach
        </AppText>
        <Button title="Fine" variant="plain" compact onPress={() => router.back()} />
      </View>
      <View style={styles.about}>
        <AboutChip text={about} />
      </View>
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={chatStyles.messages}
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 && !sender.pending ? (
          <AppText tone="textSecondary">Chiedi quello che vuoi su questo: il coach vede anche il resto dei tuoi dati.</AppText>
        ) : (
          <Messages messages={messages.map((m) => ({ ...m, about: undefined }))} sender={{ ...sender, pending: sender.pending ? { ...sender.pending, about: undefined } : null }} />
        )}
      </ScrollView>
      <InputBar sender={withAbout} autoFocus={!params.question} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, minHeight: 44 },
  about: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs },
});
