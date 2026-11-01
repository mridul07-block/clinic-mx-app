'use client';

import { parseDate, parseTime, type CalendarDate, type Time } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateField as AriaDateField,
  DateInput,
  DatePicker as AriaDatePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
  Text,
  TimeField as AriaTimeField,
} from 'react-aria-components';
import { cn } from '../cn';

/**
 * Date and time fields of design system v3 (UIX-10), on React Aria: typed day, month and year
 * segments (dd/mm/yyyy, the Indian order) with a calendar to pick from, and a 12 hour time
 * field. Each posts a hidden input under its `name` in ISO form (2026-11-01, 16:05), so server
 * actions read the same FormData as from a native date input. Values in and out are those ISO
 * strings; calendar dates have no time zone, so nothing shifts between UTC and IST. The calendar
 * is heavy: screens load these through next/dynamic.
 */

const locale = 'en-IN';

const segmentGroup =
  'flex h-row w-full items-center rounded-control border border-line-control bg-surface px-3 text-base text-ink shadow-xs hover:border-ink-muted pointer-coarse:h-row-touch pointer-coarse:text-md data-[invalid]:border-danger data-[disabled]:border-line data-[disabled]:bg-surface-subtle data-[disabled]:text-ink-faint data-[disabled]:shadow-none data-[focus-within]:outline-2 data-[focus-within]:outline-offset-2 data-[focus-within]:outline-focus';
// Each typed part is at least 24 px square (WCAG 2.2 target size); the slashes are not targets.
const segment =
  'inline-flex min-h-6 min-w-6 items-center justify-center rounded-[4px] px-0.5 tabular-nums outline-none data-[placeholder]:text-ink-faint data-[type=literal]:min-w-0 data-[type=literal]:px-0 data-[focused]:bg-accent data-[focused]:text-on-accent';

interface Common {
  label: string;
  name: string;
  helper?: ReactNode;
  /** Shown under the field, which turns red; the form's own message, not the browser's. */
  error?: string;
  optional?: boolean;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

function FieldShell({
  label,
  optional,
  helper,
  error,
  children,
}: Pick<Common, 'label' | 'optional' | 'helper' | 'error'> & { children: ReactNode }) {
  return (
    <>
      <Label className="text-base font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </Label>
      {children}
      {helper ? (
        <Text slot="description" className="text-sm text-ink-muted">
          {helper}
        </Text>
      ) : null}
      <FieldError className="flex items-start gap-1.5 text-sm text-danger">
        <CircleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
        {error}
      </FieldError>
    </>
  );
}

const toDate = (value: string | undefined): CalendarDate | undefined =>
  value ? parseDate(value) : undefined;
const toTime = (value: string | undefined): Time | undefined =>
  value ? parseTime(value) : undefined;

export interface DateFieldProps extends Common {
  /** ISO date, yyyy-mm-dd. */
  defaultValue?: string;
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** ISO dates the answer must fall between. */
  min?: string;
  max?: string;
}

/** A date typed as day, month and year, with a calendar to pick from. */
export function DatePicker({
  label,
  name,
  helper,
  error,
  optional,
  required,
  disabled,
  className,
  defaultValue,
  value,
  onChange,
  min,
  max,
}: DateFieldProps) {
  return (
    <I18nProvider locale={locale}>
      <AriaDatePicker
        name={name}
        className={cn('flex w-full flex-col gap-1.5', className)}
        defaultValue={toDate(defaultValue)}
        {...(value === undefined ? {} : { value: value ? parseDate(value) : null })}
        onChange={(next) => onChange?.(next ? next.toString() : null)}
        minValue={toDate(min)}
        maxValue={toDate(max)}
        isRequired={required}
        isDisabled={disabled}
        isInvalid={Boolean(error)}
      >
        <FieldShell label={label} optional={optional} helper={helper} error={error}>
          <Group className={cn(segmentGroup, 'pr-1')}>
            <DateInput className="flex flex-1">
              {(part) => <DateSegment segment={part} className={segment} />}
            </DateInput>
            <AriaButton
              aria-label="Choose from a calendar"
              className="flex size-8 items-center justify-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink pointer-coarse:size-10"
            >
              <CalendarDays aria-hidden strokeWidth={1.75} className="size-4" />
            </AriaButton>
          </Group>
        </FieldShell>
        <Popover
          placement="bottom end"
          className="z-50 rounded-panel border border-line bg-surface p-3 shadow-float"
        >
          <Dialog aria-label={label} className="outline-none">
            <MonthCalendar />
          </Dialog>
        </Popover>
      </AriaDatePicker>
    </I18nProvider>
  );
}

function MonthCalendar() {
  const nav =
    'flex size-9 items-center justify-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink pointer-coarse:size-11';
  return (
    <Calendar className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <AriaButton slot="previous" aria-label="Previous month" className={nav}>
          <ChevronLeft aria-hidden strokeWidth={1.75} className="size-4" />
        </AriaButton>
        <Heading className="text-base font-semibold text-ink" />
        <AriaButton slot="next" aria-label="Next month" className={nav}>
          <ChevronRight aria-hidden strokeWidth={1.75} className="size-4" />
        </AriaButton>
      </header>
      <CalendarGrid className="border-separate border-spacing-0.5">
        {(date) => (
          <CalendarCell
            date={date}
            className="flex size-9 items-center justify-center rounded-control text-base text-ink tabular-nums outline-none hover:bg-surface-hover data-[disabled]:text-ink-faint data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus data-[outside-month]:hidden data-[selected]:bg-accent data-[selected]:text-on-accent data-[unavailable]:text-ink-faint data-[unavailable]:line-through pointer-coarse:size-11"
          />
        )}
      </CalendarGrid>
    </Calendar>
  );
}

/** A date typed as day, month and year, without a calendar (a date of birth). */
export function DateField({
  label,
  name,
  helper,
  error,
  optional,
  required,
  disabled,
  className,
  defaultValue,
  value,
  onChange,
  min,
  max,
}: DateFieldProps) {
  return (
    <I18nProvider locale={locale}>
      <AriaDateField
        name={name}
        className={cn('flex w-full flex-col gap-1.5', className)}
        defaultValue={toDate(defaultValue)}
        {...(value === undefined ? {} : { value: value ? parseDate(value) : null })}
        onChange={(next) => onChange?.(next ? next.toString() : null)}
        minValue={toDate(min)}
        maxValue={toDate(max)}
        isRequired={required}
        isDisabled={disabled}
        isInvalid={Boolean(error)}
      >
        <FieldShell label={label} optional={optional} helper={helper} error={error}>
          <DateInput className={segmentGroup}>
            {(part) => <DateSegment segment={part} className={segment} />}
          </DateInput>
        </FieldShell>
      </AriaDateField>
    </I18nProvider>
  );
}

export interface TimeFieldProps extends Common {
  /** 24 hour ISO time, HH:mm. */
  defaultValue?: string;
  value?: string | null;
  onChange?: (value: string | null) => void;
}

/** A time typed as hour, minute and AM or PM; posts HH:mm. */
export function TimeField({
  label,
  name,
  helper,
  error,
  optional,
  required,
  disabled,
  className,
  defaultValue,
  value,
  onChange,
}: TimeFieldProps) {
  return (
    <I18nProvider locale={locale}>
      <AriaTimeField
        name={name}
        className={cn('flex w-full flex-col gap-1.5', className)}
        hourCycle={12}
        defaultValue={toTime(defaultValue)}
        {...(value === undefined ? {} : { value: value ? parseTime(value) : null })}
        onChange={(next) => onChange?.(next ? next.toString().slice(0, 5) : null)}
        isRequired={required}
        isDisabled={disabled}
        isInvalid={Boolean(error)}
      >
        <FieldShell label={label} optional={optional} helper={helper} error={error}>
          <DateInput className={segmentGroup}>
            {(part) => <DateSegment segment={part} className={segment} />}
          </DateInput>
        </FieldShell>
      </AriaTimeField>
    </I18nProvider>
  );
}
