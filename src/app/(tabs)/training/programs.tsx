import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { ActionRow, ListGroup, Row } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { useLiveQuery } from '@/db/live';
import { deleteProgram, getPrograms, type Program } from '@/db/programs';
import { countLabel } from '@/lib/format';

/** Every program, the one in use first. Building one takes time, so deleting it asks first. */
export default function ProgramsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { data } = useLiveQuery('programs', getPrograms, ['training']);
  const programs = [...(data ?? [])].sort((a, b) => Number(b.active) - Number(a.active));

  const confirm = (program: Program) => () =>
    confirmDestructive({
      title: `Eliminare ${program.name}?`,
      message: 'Gli allenamenti fatti restano nello storico.',
      action: 'Elimina scheda',
    });

  return (
    <ScreenScroll>
      <ListGroup>
        {programs.map((p) => (
          <SwipeToDelete key={p.id} confirm={confirm(p)} onDelete={() => void deleteProgram(db, p.id)}>
            <Row
              title={p.name}
              subtitle={`${countLabel(p.days.length, 'giorno', 'giorni')}${p.active ? ' · in uso' : ''}`}
              icon={
                <Icon
                  name={p.active ? 'checkmark.circle.fill' : 'list.bullet.rectangle'}
                  size={20}
                  tone={p.active ? 'accent' : 'textSecondary'}
                />
              }
              onPress={() => router.push({ pathname: '/training/program', params: { id: p.id } })}
            />
          </SwipeToDelete>
        ))}
        <ActionRow label="Nuova scheda" onPress={() => router.push('/training/new')} />
      </ListGroup>
    </ScreenScroll>
  );
}
