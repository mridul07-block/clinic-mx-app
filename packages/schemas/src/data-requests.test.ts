import { describe, expect, it } from 'vitest';
import {
  closeDataRequestSchema,
  dataRequestDueOn,
  dataRequestOverdue,
  dataRequestSchema,
} from './data-requests';

// ADM-03: what a data request holds, when it is due, and how it closes.
describe('data requests', () => {
  const patientId = '00000000-0000-4000-8000-000000000301';

  it('takes what was asked, of which kind, on which day', () => {
    expect(
      dataRequestSchema.safeParse({
        patientId,
        kind: 'export',
        receivedOn: '2026-10-29',
        details: '  A copy of everything  ',
      }).data,
    ).toEqual({
      patientId,
      kind: 'export',
      receivedOn: '2026-10-29',
      details: 'A copy of everything',
    });
    expect(
      dataRequestSchema.safeParse({
        patientId,
        kind: 'erase',
        receivedOn: '2026-10-29',
        details: 'x',
      }).success,
    ).toBe(false);
    expect(
      dataRequestSchema.safeParse({
        patientId,
        kind: 'export',
        receivedOn: '2026-10-29',
        details: ' ',
      }).success,
    ).toBe(false);
  });

  it('closes only as done or declined, saying what was done', () => {
    const requestId = patientId;
    expect(
      closeDataRequestSchema.safeParse({ requestId, status: 'open', outcome: 'x' }).success,
    ).toBe(false);
    expect(
      closeDataRequestSchema.safeParse({ requestId, status: 'done', outcome: '' }).success,
    ).toBe(false);
  });

  it('is due the setting’s days after it was received, and overdue only while open', () => {
    expect(dataRequestDueOn('2026-10-29', 30)).toBe('2026-11-28');
    expect(dataRequestOverdue({ status: 'open', dueOn: '2026-11-28' }, '2026-11-29')).toBe(true);
    expect(dataRequestOverdue({ status: 'open', dueOn: '2026-11-28' }, '2026-11-28')).toBe(false);
    expect(dataRequestOverdue({ status: 'done', dueOn: '2026-11-28' }, '2026-12-01')).toBe(false);
  });
});
