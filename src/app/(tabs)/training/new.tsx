import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert } from 'react-native';

import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { toast } from '@/components/toast';
import { createProgram, createProgramFromTemplate } from '@/db/programs';
import { countLabel } from '@/lib/format';
import { PROGRAM_TEMPLATES, type ProgramTemplate } from '@/lib/templates';
import { haptics } from '@/services/haptics';

/** A new program: from a tested template, which can then be changed freely, or empty. */
export default function NewProgramScreen() {
  const db = useSQLiteContext();
  const router = useRouter();

  const fromTemplate = async (template: ProgramTemplate) => {
    const id = await createProgramFromTemplate(db, template);
    haptics.success();
    toast.show(`${template.name} in uso`, 'checkmark.circle.fill');
    router.replace({ pathname: '/training/program', params: { id } });
  };

  const empty = () =>
    Alert.prompt(
      'Nuova scheda',
      undefined,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Crea',
          onPress: async (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (trimmed === '') return;
            const id = await createProgram(db, trimmed);
            haptics.success();
            router.replace({ pathname: '/training/program', params: { id } });
          },
        },
      ],
      'plain-text',
      'La mia scheda',
    );

  return (
    <ScreenScroll>
      <SectionTitle>Parti da un modello</SectionTitle>
      <ListGroup>
        {PROGRAM_TEMPLATES.map((t) => (
          <Row
            key={t.key}
            title={`${t.name} · ${countLabel(t.days.length, 'giorno', 'giorni')}`}
            subtitle={t.description}
            icon={<Icon name="list.bullet.rectangle.portrait" size={20} tone="accent" />}
            onPress={() => void fromTemplate(t)}
          />
        ))}
      </ListGroup>
      <SectionFooter>
        Ogni esercizio ha serie e una fascia di ripetizioni (es. 3 × 8–12): l’app ti propone il carico in base a come è
        andata la volta prima. Puoi cambiare esercizi, serie e recuperi quando vuoi. Se riprendi dopo una lunga pausa,
        nelle prime 2–3 settimane fermati a 2–3 ripetizioni dal cedimento.
      </SectionFooter>

      <SectionTitle>Oppure</SectionTitle>
      <ListGroup>
        <Row
          title="Scheda vuota"
          subtitle="Per ricopiare quella del PT o di un amico"
          icon={<Icon name="square.and.pencil" size={20} tone="accent" />}
          onPress={empty}
        />
      </ListGroup>
    </ScreenScroll>
  );
}
