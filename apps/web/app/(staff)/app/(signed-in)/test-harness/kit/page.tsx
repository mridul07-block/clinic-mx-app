import { Checkbox } from '@clinic-mx/ui/components/checkbox';
import { CountChip } from '@clinic-mx/ui/components/count-chip';
import { DateField, DatePicker, TimeField } from '@clinic-mx/ui/components/date-picker';
import { ErrorSummary, Field } from '@clinic-mx/ui/components/field';
import { Input, Textarea } from '@clinic-mx/ui/components/input';
import { RadioGroup } from '@clinic-mx/ui/components/radio-group';
import { SegmentedControl } from '@clinic-mx/ui/components/segmented-control';
import { Select } from '@clinic-mx/ui/components/select';
import { Switch } from '@clinic-mx/ui/components/switch';
import { Tag, type TagTone } from '@clinic-mx/ui/components/tag';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';
import { KitDemos } from './kit-demos';

// Component kit test harness (UIX-08; end to end tests only, 404 unless CLINIC_MX_TEST_HARNESS=1):
// every form control of design system v3 section 8 in each state, with made up labels and no
// patients, at 360 px first and on desktop.
export const dynamic = 'force-dynamic';

const tones: TagTone[] = [
  'neutral',
  'outline',
  'info',
  'waiting',
  'active',
  'done',
  'danger',
  'emergency',
  'muted',
];

const toneWords: Record<TagTone, string> = {
  neutral: 'Confirmed',
  outline: 'Booked',
  info: 'Checked in',
  waiting: 'Overdue',
  active: 'In progress',
  done: 'Completed',
  danger: 'No show',
  emergency: 'Emergency',
  muted: 'Draft',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-4 shadow-xs sm:p-5">
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function KitHarnessPage() {
  if (!testHarnessEnabled()) notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <h1 className="text-title font-semibold">Component kit: form controls</h1>

      <Section title="Error summary">
        <ErrorSummary
          errors={[
            { fieldId: 'kit-email-error', message: 'Enter an email address like name@example.com' },
            { fieldId: 'kit-plan', message: 'Choose a plan length' },
          ]}
        />
      </Section>

      <Section title="Inputs">
        <Field label="Email" helper="We send the receipt here">
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
            />
          )}
        </Field>
        <Field label="Email with an error" id="kit-email-error" error="Enter an email address">
          {(control) => <Input {...control} name="emailWrong" defaultValue="name@" />}
        </Field>
        <Field label="Reference" optional>
          {(control) => <Input {...control} name="reference" />}
        </Field>
        <Field label="Locked field" helper="Set by the clinic">
          {(control) => <Input {...control} name="locked" defaultValue="Centre one" disabled />}
        </Field>
        <Field label="Amount">
          {(control) => (
            <Input
              {...control}
              name="amount"
              inputMode="decimal"
              size="large"
              defaultValue="1200"
            />
          )}
        </Field>
        <Field label="Note" helper="A sentence or two">
          {(control) => <Textarea {...control} name="note" />}
        </Field>
        <Field label="Note with an error" error="Write a note">
          {(control) => <Textarea {...control} name="noteWrong" />}
        </Field>
      </Section>

      <Section title="Select">
        <Field label="Centre">
          {(control) => (
            <Select {...control} name="centre" placeholder="Choose a centre">
              <option value="one">Centre one</option>
              <option value="two">Centre two</option>
              <option value="three">Centre three</option>
            </Select>
          )}
        </Field>
        <Field label="Centre with an error" error="Choose a centre">
          {(control) => (
            <Select {...control} name="centreWrong" placeholder="Choose a centre">
              <option value="one">Centre one</option>
            </Select>
          )}
        </Field>
        <Field label="Locked centre">
          {(control) => (
            <Select {...control} name="centreLocked" defaultValue="two" disabled>
              <option value="one">Centre one</option>
              <option value="two">Centre two</option>
            </Select>
          )}
        </Field>
      </Section>

      <Section title="Checkboxes">
        <div className="flex flex-col">
          <Checkbox name="terms" label="Unticked" />
          <Checkbox name="ticked" label="Ticked" defaultChecked />
          <Checkbox
            name="described"
            label="With a second line"
            description="A short explanation under the label"
          />
          <Checkbox name="invalid" label="With an error" aria-invalid />
          <Checkbox name="off" label="Disabled" disabled />
          <Checkbox name="offOn" label="Disabled and ticked" disabled defaultChecked />
        </div>
      </Section>

      <Section title="Choice rows">
        <RadioGroup
          name="plan"
          legend="Plan length"
          helper="You can change it later"
          defaultValue="six"
          options={[
            { value: 'four', label: 'Four weeks' },
            { value: 'six', label: 'Six weeks', description: 'The usual length' },
            { value: 'eight', label: 'Eight weeks' },
            { value: 'twelve', label: 'Twelve weeks', disabled: true },
          ]}
        />
        <RadioGroup
          name="planWrong"
          id="kit-plan"
          legend="Plan length with an error"
          error="Choose a plan length"
          options={[
            { value: 'four', label: 'Four weeks' },
            { value: 'six', label: 'Six weeks' },
          ]}
        />
        <RadioGroup
          name="planLocked"
          legend="Locked choice"
          optional
          disabled
          defaultValue="four"
          options={[
            { value: 'four', label: 'Four weeks' },
            { value: 'six', label: 'Six weeks' },
          ]}
        />
      </Section>

      <Section title="Switches">
        <div className="flex flex-col">
          <Switch name="reminders" label="Off" />
          <Switch name="alerts" label="On" defaultChecked />
          <Switch
            name="digest"
            label="With a second line"
            description="A short explanation under the label"
          />
          <Switch name="lockedOff" label="Disabled" disabled />
          <Switch name="lockedOn" label="Disabled and on" disabled defaultChecked />
        </div>
      </Section>

      <Section title="Segmented controls">
        <SegmentedControl
          name="answer"
          legend="No answer yet"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
        <SegmentedControl
          name="side"
          legend="Chosen"
          defaultValue="left"
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <SegmentedControl
          name="answerWrong"
          legend="With an error"
          error="Choose yes or no"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
        <SegmentedControl
          name="answerLocked"
          legend="Read only"
          disabled
          defaultValue="no"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
        <SegmentedControl
          name="time"
          legend="Free times in a grid"
          trackClassName="grid grid-cols-3 sm:grid-cols-6"
          options={[
            { value: '09:00', label: '9:00 AM' },
            { value: '09:30', label: '9:30 AM' },
            { value: '10:00', label: '10:00 AM' },
            { value: '10:30', label: '10:30 AM' },
            { value: '11:00', label: '11:00 AM', disabled: true },
            { value: '11:30', label: '11:30 AM' },
          ]}
        />
      </Section>

      <Section title="Tags">
        {(['default', 'small'] as const).map((size) => (
          <div key={size} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink-muted">
              {size === 'default' ? 'Default' : 'Small'}
            </h3>
            <div className="flex flex-wrap gap-2">
              {tones.map((tone) => (
                <Tag key={tone} tone={tone} size={size}>
                  {toneWords[tone]}
                </Tag>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {tones.map((tone) => (
                <Tag key={tone} tone={tone} size={size} dot>
                  {toneWords[tone]}
                </Tag>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Count chips">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
          <CountChip href="?view=arrive" label="To arrive" count={12} selected />
          <CountChip href="?view=here" label="Here now" count={4} />
          <CountChip href="?view=done" label="Done" count={30} />
        </nav>
      </Section>

      <Section title="Dates and times">
        <DatePicker label="Visit date" name="visitDate" defaultValue="2026-11-03" />
        <DatePicker
          label="Visit date with an error"
          name="visitDateError"
          error="Choose a date from today on"
        />
        <DateField label="Date of birth" name="dateOfBirth" optional defaultValue="1986-09-04" />
        <TimeField label="Start time" name="startTime" defaultValue="16:05" helper="In IST" />
        <DatePicker label="Locked date" name="lockedDate" defaultValue="2026-11-03" disabled />
      </Section>

      <Section title="With JavaScript">
        <KitDemos />
      </Section>
    </main>
  );
}
