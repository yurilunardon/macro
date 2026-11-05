import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ScreenScroll } from '@/components/screen';
import { TimePicker } from '@/components/time-picker';
import { WeekdayPicker } from '@/components/weekday-picker';
import { useLiveQuery } from '@/db/live';
import { getWeighInPlan } from '@/db/plan';
import { setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { parseTimeKey, timeKey } from '@/lib/calendar';
import type { WeighInPlan } from '@/lib/plan';

/** When the weigh-in is in the day: every day or some days, at a time. */
export default function WeighInScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { data: plan } = useLiveQuery('weigh-in-plan', getWeighInPlan, ['settings']);
  if (!plan) return <ScreenScroll>{null}</ScreenScroll>;
  const save = (fields: Partial<WeighInPlan>) => void setSetting(db, 'weighInPlan', { ...plan, ...fields });

  return (
    <ScreenScroll>
      <ListGroup>
        <Row
          title="Nel piano"
          chevron={false}
          detail={<Switch value={plan.enabled} onValueChange={(enabled) => save({ enabled })} trackColor={{ true: theme.accent }} accessibilityLabel="Pesata nel piano" />}
        />
        {plan.enabled ? (
          <Row
            title="Ogni quanto"
            chevron={false}
            detail={
              <MenuButton
                icon="calendar"
                accessibilityLabel="Ogni quanto pesarsi"
                groups={[
                  {
                    actions: [
                      { label: 'Ogni giorno', checked: plan.schedule === 'daily', onPress: () => save({ schedule: 'daily' }) },
                      { label: 'Alcuni giorni', checked: plan.schedule === 'weekdays', onPress: () => save({ schedule: 'weekdays' }) },
                    ],
                  },
                ]}>
                <View style={styles.pick}>
                  <AppText tone="accent">{plan.schedule === 'daily' ? 'Ogni giorno' : 'Alcuni giorni'}</AppText>
                  <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
                </View>
              </MenuButton>
            }
          />
        ) : null}
        {plan.enabled && plan.schedule === 'weekdays' ? <WeekdayPicker value={plan.weekdays} onChange={(weekdays) => save({ weekdays })} /> : null}
        {plan.enabled ? (
          <Row
            title="Ora"
            chevron={false}
            detail={<TimePicker {...parseTimeKey(plan.time)} accessibilityLabel="Ora della pesata" onChange={(t) => save({ time: timeKey(t.hour, t.minute) })} />}
          />
        ) : null}
      </ListGroup>
      <SectionFooter>
        Appena sveglio, dopo il bagno e prima di bere o mangiare, sempre sulla stessa bilancia. Conta la media di 7 giorni, non il
        singolo giorno: acqua, sale e creatina lo fanno ballare di un chilo o due.
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
});
