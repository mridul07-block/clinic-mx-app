import { selfBookingBlock } from './slots';

/**
 * Whether the patient may move an appointment on the WhatsApp reschedule Flow (WA-05), and the
 * reschedules left it shows (user decision, 31 October 2026: both limits, as they apply). The
 * front desk can always move it; these refusals are for the patient's own move only.
 */

export type RescheduleRefusal = 'treadmill' | 'self_booking' | 'package_used' | 'not_movable';

export const rescheduleRefusalMessages: Record<RescheduleRefusal, string> = {
  // The Frontend Specification: the Reschedule screen is blocked for Zero Gravity Treadmill
  // sessions; `packages.never_reschedulable_items` names them.
  treadmill: 'Zero Gravity Treadmill sessions cannot be moved online.',
  self_booking:
    'Online changes are paused for this patient after several reschedules or missed visits.',
  package_used: 'This package has no reschedules left, so this session cannot be moved online.',
  not_movable: 'This appointment can no longer be moved online.',
};

export interface SelfRescheduleCheck {
  refusal: RescheduleRefusal | null;
  /** The reschedules left, as the form shows them. */
  lines: string[];
}

const times = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function selfRescheduleCheck(input: {
  typeKey: string;
  /** `packages.never_reschedulable_items`: matched against the appointment type's key (SCH-10). */
  neverReschedulable: readonly string[];
  /** A package session's allowance (SCH-10); null for any other appointment. */
  packageSession: { reschedulesLeft: number } | null;
  /** The self booking counts and their limits (SCH-09). */
  counts: { reschedules: number; noShows: number };
  limits: { reschedules: number; noShows: number };
}): SelfRescheduleCheck {
  const onlineLeft = Math.max(input.limits.reschedules - input.counts.reschedules, 0);
  const lines = [
    ...(input.packageSession
      ? [
          `This package has ${times(input.packageSession.reschedulesLeft, 'reschedule', 'reschedules')} left; moving uses one.`,
        ]
      : []),
    `You can move appointments online ${times(onlineLeft, 'more time', 'more times')}.`,
  ];
  const refusal: RescheduleRefusal | null = input.neverReschedulable.includes(input.typeKey)
    ? 'treadmill'
    : selfBookingBlock(input.counts, input.limits).blocked
      ? 'self_booking'
      : input.packageSession?.reschedulesLeft === 0
        ? 'package_used'
        : null;
  return { refusal, lines };
}
