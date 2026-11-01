'use client';

import { CountChip } from '@clinic-mx/ui/components/count-chip';
import { SegmentedControl } from '@clinic-mx/ui/components/segmented-control';
import { Switch } from '@clinic-mx/ui/components/switch';
import { useState } from 'react';

const views = [
  { value: 'arrive', label: 'To arrive', count: 12 },
  { value: 'here', label: 'Here now', count: 4 },
  { value: 'done', label: 'Done', count: 30 },
] as const;

type View = (typeof views)[number]['value'];

/** Controlled demos for the kit harness: each shows the value it holds. */
export function KitDemos() {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const [on, setOn] = useState(false);
  const [view, setView] = useState<View>('arrive');
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        name="controlledAnswer"
        legend="Controlled segmented control"
        value={answer}
        onChange={setAnswer}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ]}
      />
      <p className="text-sm text-ink-muted" data-testid="kit-answer">
        Answer: {answer ?? 'none'}
      </p>
      <Switch
        name="controlledSwitch"
        label="Controlled switch"
        checked={on}
        onChange={(event) => {
          setOn(event.target.checked);
        }}
      />
      <p className="text-sm text-ink-muted" data-testid="kit-switch">
        Switch: {on ? 'on' : 'off'}
      </p>
      <div className="flex flex-wrap gap-2">
        {views.map((item) => (
          <CountChip
            key={item.value}
            label={item.label}
            count={item.count}
            selected={view === item.value}
            onClick={() => {
              setView(item.value);
            }}
          />
        ))}
      </div>
    </div>
  );
}
