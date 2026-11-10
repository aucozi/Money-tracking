import { useState } from 'react';

import { Bills } from '@/features/plan/bills';
import { DebtPlanner } from '@/features/plan/debt';
import { ForecastView } from '@/features/plan/forecast';
import { Goals } from '@/features/plan/goals';
import { TabHeader } from '@/features/shared';
import { Screen, Segmented } from '@/ui/primitives';

type Section = 'bills' | 'forecast' | 'goals' | 'debt';

export default function Plan() {
  const [section, setSection] = useState<Section>('bills');
  return (
    <Screen testID="plan">
      <TabHeader title="Plan" subtitle="What is coming, and where you are heading" />
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { value: 'bills', label: 'Bills' },
          { value: 'forecast', label: 'Forecast' },
          { value: 'goals', label: 'Goals' },
          { value: 'debt', label: 'Debt' },
        ]}
        testID="plan-sections"
      />
      {section === 'bills' ? <Bills /> : section === 'forecast' ? <ForecastView /> : section === 'goals' ? <Goals /> : <DebtPlanner />}
    </Screen>
  );
}
