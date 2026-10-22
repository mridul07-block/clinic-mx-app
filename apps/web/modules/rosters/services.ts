import 'server-only';
import {
  assignedToCentre,
  cancelLeave,
  decideLeave,
  insertLeave,
  leaveRecord,
  rosterVersions,
  saveRoster,
  staffRecord,
  versionsFrom,
} from '@clinic-mx/db';
import {
  blocksOnGrid,
  blocksOverlap,
  istDate,
  leaveCancelSchema,
  leaveDecisionSchema,
  leaveFirstDay,
  leaveWindow,
  personLeaveSchema,
  rosterSchema,
  slotMessage,
  weekdayNames,
  type LeaveInput,
} from '@clinic-mx/schemas';
import { staffService, type ServiceContext, type ServiceTransaction } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * Rosters and leave (SET-04, PRD M2). Centre Managers and the Super Admin set rosters
 * (rosters.manage) and decide leave for the people they manage; anyone who treats patients
 * requests their own leave (leave.manage, own). Nobody decides or records their own leave. Each is
 * a staffService under row level security, audited. The slot length is read before a service's
 * transaction opens: the app has one database connection per server instance (SET-03).
 */

/** A refusal to show as it is; `field` names the form field it belongs to, if any. */
export class RosterError extends Error {
  override name = 'RosterError';
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

const today = () => istDate(new Date());
const slotMinutes = () => getSetting('scheduling.slot_minutes');

/** Leave that overlaps requested or approved leave is refused by the database (23P01). */
async function refusingOverlaps<R>(work: Promise<R>): Promise<R> {
  try {
    return await work;
  } catch (error) {
    const code =
      (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === '23P01') {
      throw new RosterError('This overlaps leave already requested or approved.');
    }
    throw error;
  }
}

async function treatingMember(tx: ServiceTransaction, staffUserId: string) {
  const member = await staffRecord(tx, staffUserId);
  if (!member?.active) throw new RosterError('That person was not found.');
  if (!member.treatsPatients) {
    throw new RosterError('Only people who treat patients have rosters and leave here.');
  }
  return member;
}

/**
 * Sets a person's weekly hours at a centre from a date (today or later). It replaces a version
 * starting the same day, and must not clash with their hours at another centre.
 */
export async function saveRosterService(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return staffService({
    action: 'rosters.manage',
    input: rosterSchema,
    target: ({ centreId }) => Promise.resolve({ centreId }),
    run: async (tx, { staffUserId, centreId, effectiveFrom, days }, actor) => {
      await treatingMember(tx, staffUserId);
      if (!(await assignedToCentre(tx, staffUserId, centreId))) {
        throw new RosterError(
          'They do not work at that centre. Add the centre on their staff page first.',
          'centreId',
        );
      }
      if (effectiveFrom < today()) {
        throw new RosterError('Choose today or a later date.', 'effectiveFrom');
      }
      days.forEach((blocks, i) => {
        if (!blocksOnGrid(blocks, slot))
          throw new RosterError(slotMessage(slot), `day${String(i)}`);
      });
      const elsewhere = versionsFrom(
        (await rosterVersions(tx, staffUserId)).filter((v) => v.centreId !== centreId),
        effectiveFrom,
      );
      for (const version of elsewhere) {
        days.forEach((blocks, i) => {
          if (blocksOverlap(blocks, version.weekly[i] ?? [])) {
            throw new RosterError(
              `This overlaps their hours at ${version.centreName} on ${weekdayNames[i] ?? ''}.`,
              `day${String(i)}`,
            );
          }
        });
      }
      return saveRoster(tx, {
        staffUserId,
        centreId,
        effectiveFrom,
        weekly: days,
        createdBy: actor.id,
      });
    },
  })(context, rawInput);
}

function checkLeaveTimes(leave: LeaveInput, slot: number) {
  if (leave.kind === 'part' && (leave.fromTime % slot !== 0 || leave.toTime % slot !== 0)) {
    throw new RosterError(slotMessage(slot), 'toTime');
  }
}

/** A person requests their own leave, from today on. Their manager decides. */
export async function requestLeave(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return refusingOverlaps(
    staffService({
      action: 'leave.manage',
      input: personLeaveSchema,
      target: ({ staffUserId }) => Promise.resolve({ ownerId: staffUserId }),
      run: async (tx, leave, actor) => {
        if (leave.staffUserId !== actor.id) throw new RosterError('Request your own leave here.');
        await treatingMember(tx, leave.staffUserId);
        if (leaveFirstDay(leave) < today()) {
          throw new RosterError(
            'Leave can start today or later.',
            leave.kind === 'days' ? 'from' : 'date',
          );
        }
        checkLeaveTimes(leave, slot);
        return insertLeave(tx, {
          staffUserId: leave.staffUserId,
          ...leaveWindow(leave),
          note: leave.note,
          status: 'requested',
          requestedBy: actor.id,
        });
      },
    })(context, rawInput),
  );
}

/** A manager records someone's leave as approved, for example sick leave already taken. */
export async function recordLeave(context: ServiceContext, rawInput: unknown) {
  const slot = await slotMinutes();
  return refusingOverlaps(
    staffService({
      action: 'leave.manage',
      input: personLeaveSchema,
      target: ({ staffUserId }) => Promise.resolve({ ownerId: staffUserId }),
      run: async (tx, leave, actor) => {
        if (leave.staffUserId === actor.id) {
          throw new RosterError('Request your own leave from My leave; a manager decides it.');
        }
        await treatingMember(tx, leave.staffUserId);
        checkLeaveTimes(leave, slot);
        return insertLeave(tx, {
          staffUserId: leave.staffUserId,
          ...leaveWindow(leave),
          note: leave.note,
          status: 'approved',
          requestedBy: actor.id,
        });
      },
    })(context, rawInput),
  );
}

const leaveOwner = async ({ leaveId }: { leaveId: string }, tx: ServiceTransaction) => {
  const leave = await leaveRecord(tx, leaveId);
  return leave ? { ownerId: leave.staffUserId } : {};
};

/** A manager approves or declines requested leave, never their own. */
export const decideLeaveService = staffService({
  action: 'leave.manage',
  input: leaveDecisionSchema,
  target: leaveOwner,
  run: async (tx, { leaveId, decision, reason }, actor) => {
    const leave = await leaveRecord(tx, leaveId);
    if (!leave) throw new RosterError('That leave was not found.');
    if (leave.staffUserId === actor.id) {
      throw new RosterError('Your own leave is decided by another manager or the Super Admin.');
    }
    if (
      !(await decideLeave(tx, leaveId, {
        approve: decision === 'approve',
        decidedBy: actor.id,
        reason,
      }))
    ) {
      throw new RosterError('That leave has already been decided or cancelled.');
    }
  },
});

/**
 * Cancels leave: a person their own request while it waits; a manager any requested or approved
 * leave of the people they manage.
 */
export const cancelLeaveService = staffService({
  action: 'leave.manage',
  input: leaveCancelSchema,
  target: leaveOwner,
  run: async (tx, { leaveId }, actor) => {
    const leave = await leaveRecord(tx, leaveId);
    if (!leave) throw new RosterError('That leave was not found.');
    if (leave.staffUserId === actor.id && leave.status !== 'requested') {
      throw new RosterError('Decided leave is cancelled by your manager.');
    }
    if (!(await cancelLeave(tx, leaveId))) {
      throw new RosterError('That leave has already been decided or cancelled.');
    }
  },
});
