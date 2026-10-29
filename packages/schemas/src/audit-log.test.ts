import { describe, expect, it } from 'vitest';
import {
  auditActorLabel,
  auditCategory,
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
});
