import 'server-only';
import { withStaffAccess, type Db, type StaffMember } from '@clinic-mx/db';
import type { AccessTarget, Action } from '@clinic-mx/schemas';
import type { z } from 'zod';
import { assertCan, assertMay } from './guard';

export type ServiceTransaction = Parameters<Parameters<typeof withStaffAccess>[2]>[0];

export interface ServiceContext {
  db: Db;
  actor: StaffMember;
  /** The request's client address, for the audit trail. */
  ip?: string;
}

export interface ServiceDefinition<S extends z.ZodType, R> {
  action: Action;
  input: S;
  /** The record the input is about (its centre, its owner), read inside the transaction. */
  target?: (input: z.output<S>, tx: ServiceTransaction) => Promise<AccessTarget>;
  run: (tx: ServiceTransaction, input: z.output<S>, actor: StaffMember) => Promise<R>;
}

/**
 * A module service function (rule 17, IAM-04): permission, validate, transaction, audit event.
 * In order: the role and ticks may take `action`; the input passes its zod schema (a ZodError
 * otherwise); then one transaction, as the actor under row level security (IAM-05) and named
 * for the audit trail, checks the record's centre and owner from `target` and runs the work.
 * Every write in apps/web goes through here; ESLint refuses the audited writers anywhere else.
 */
export function staffService<S extends z.ZodType, R>(definition: ServiceDefinition<S, R>) {
  return async ({ db, actor, ip }: ServiceContext, rawInput: unknown): Promise<R> => {
    assertMay(actor, definition.action);
    const input = definition.input.parse(rawInput);
    return withStaffAccess(db, { actor, ip }, async (tx) => {
      // Without a target, a grant for one's own records only is refused: there is no owner.
      const target = definition.target ? await definition.target(input, tx) : {};
      assertCan(actor, definition.action, target);
      return definition.run(tx, input, actor);
    });
  };
}
