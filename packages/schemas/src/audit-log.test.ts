import { describe, expect, it } from 'vitest';
import {
  auditActorLabel,
  auditCategory,
  auditCsv,
  auditDownloadRefusalText,
  auditDownloadSpan,
  auditEntityLabel,
  auditLogQuery,
  auditPlacedTables,
  auditSetupTables,
  auditPartsFor,
  auditTablesOf,
  auditValue,
} from './audit-log';
import type { StaffAccess } from './permissions';

const person = (role: StaffAccess['role'], extra: Partial<StaffAccess> = {}): StaffAccess => ({
  id: '00000000-0000-4000-8000-000000000201',
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
  ...extra,
});

// ADM-01: who reads which part of the audit trail (PRD section 2).
describe('the audit log', () => {
  it('gives the Super Admin every part, Centre Managers clinical, Finance finance, others none', () => {
    expect(auditPartsFor(person('super_admin'))).toEqual(['clinical', 'finance', 'admin']);
    expect(auditPartsFor(person('centre_manager'))).toEqual(['clinical']);
    expect(auditPartsFor(person('finance'))).toEqual(['finance']);
    expect(auditPartsFor(person('front_desk'))).toEqual([]);
    expect(auditPartsFor(person('physiotherapist', { treatsPatients: true }))).toEqual([]);
    // Velyx support: the trail holds clinical rows.
    expect(auditPartsFor(person('super_admin', { support: true }))).toEqual([]);
  });

  it('puts each table in one part; money is never clinical', () => {
    expect(auditCategory('consultation')).toBe('clinical_record');
    expect(auditCategory('appointment')).toBe('clinical');
    expect(auditCategory('payment')).toBe('finance');
    expect(auditCategory('plan_choice')).toBe('finance');
    expect(auditCategory('staff_user')).toBe('admin');
    expect(auditCategory('setting')).toBe('admin');
    const clinical = auditTablesOf('clinical');
    for (const table of auditTablesOf('finance')) expect(clinical).not.toContain(table);
    expect(auditTablesOf('admin')).toEqual([]);
  });

  it('names tables, people and values for reading', () => {
    expect(auditEntityLabel('red_flag_alert')).toBe('Red flag alert');
    expect(auditEntityLabel('kb_condition')).toBe('Knowledge base condition');
    expect(auditActorLabel('staff:00000000-0000-4000-8000-000000000201', 'Test Name')).toBe(
      'Test Name',
    );
    expect(auditActorLabel('patient:00000000-0000-4000-8000-000000000201', null)).toBe(
      'Patient, through a link',
    );
    expect(auditActorLabel('system:jobs', null)).toBe('System (jobs)');
    expect(auditValue(null)).toBe('empty');
    expect(auditValue({ a: 1 })).toBe('{"a":1}');
    expect(auditValue('x'.repeat(100))).toHaveLength(80);
  });

  it('drops a malformed filter and keeps the others', () => {
    expect(auditLogQuery({ part: 'clinical', before: '42' })).toEqual({
      part: 'clinical',
      before: 42,
    });
    expect(auditLogQuery({ part: 'everything', entity: 'bill' })).toEqual({ entity: 'bill' });
    expect(auditLogQuery({ entity: 'bill; drop', from: '2026-02-30', to: '2026-03-01' })).toEqual({
      to: '2026-03-01',
    });
    expect(auditLogQuery({ before: 'abc', part: 'finance' })).toEqual({ part: 'finance' });
  });

  it('places each table once', () => {
    expect(new Set(auditPlacedTables).size).toBe(auditPlacedTables.length);
    for (const table of auditSetupTables) expect(auditCategory(table)).toBe('admin');
  });

  it('downloads a chosen span of days, no longer than the setting', () => {
    expect(auditDownloadSpan({ from: '2026-10-01' }, 31)).toEqual({
      ok: false,
      refusal: 'no_span',
    });
    expect(auditDownloadSpan({ from: '2026-10-02', to: '2026-10-01' }, 31)).toEqual({
      ok: false,
      refusal: 'reversed',
    });
    expect(auditDownloadSpan({ from: '2026-10-01', to: '2026-10-31' }, 31)).toEqual({
      ok: true,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(auditDownloadSpan({ from: '2026-10-01', to: '2026-11-01' }, 31)).toEqual({
      ok: false,
      refusal: 'too_long',
    });
    expect(auditDownloadRefusalText('too_long', 31, 5000)).toBe(
      'Choose at most 31 days to download.',
    );
    expect(auditDownloadRefusalText('too_many', 31, 5000)).toContain('More than 5,000 events');
  });

  it('writes the events as CSV, withheld values marked hidden, formulas never run', () => {
    const csv = auditCsv([
      {
        id: 2,
        at: new Date('2026-10-29T05:00:00Z'),
        actor: 'staff:00000000-0000-4000-8000-000000000201',
        actorName: '=Test Name',
        action: 'update',
        entity: 'measure',
        entityId: '00000000-0000-4000-8000-000000000301',
        category: 'clinical_record',
        before: null,
        after: null,
        changed: ['value'],
        redacted: true,
        hiddenFields: [],
      },
      {
        id: 1,
        at: new Date('2026-10-29T04:00:00Z'),
        actor: 'system:jobs',
        actorName: null,
        action: 'update',
        entity: 'setting',
        entityId: null,
        category: 'admin',
        before: { value: '=1+1' },
        after: { value: 2 },
        changed: ['value'],
        redacted: false,
        hiddenFields: [],
      },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Event,When (IST),Who,What,Record type,Part,Record,Fields,Before,After');
    // A name that starts like a formula is quoted so it never runs.
    expect(lines[1]).toBe(
      '2,"29 Oct 2026, 10:30 IST",\'=Test Name,Changed,Measure,Clinical record,00000000-0000-4000-8000-000000000301,value,hidden,hidden',
    );
    expect(lines[2]).toContain('System (jobs),Changed,Setting,Setup,,value,');
    expect(lines[2]).toContain('"{""value"":""=1+1""}"');
  });
});
