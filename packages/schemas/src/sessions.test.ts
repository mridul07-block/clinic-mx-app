import { describe, expect, it } from 'vitest';
import {
  emptySessionNote,
  prefilledSessionNote,
  readSessionNote,
  sessionAddendumSchema,
  sessionGate,
  sessionLabel,
  sessionNoteBlockers,
  sessionNoteSchema,
  sessionView,
  type SessionNote,
} from './sessions';

// SES-01: "Session n of N" and the gate a session starts behind.
describe('sessionLabel', () => {
  it('counts against the planned sessions, or alone without a frequency', () => {
    expect(sessionLabel(3, 12)).toBe('Session 3 of 12');
    expect(sessionLabel(1, null)).toBe('Session 1');
  });
});

describe('sessionView', () => {
  it('labels a checked in session and gives the gate; nothing for other appointments', () => {
    expect(sessionView({ number: 2, planned: 12, episodeStatus: 'active' })).toEqual({
      label: 'Session 2 of 12',
      gate: { met: true, message: 'Payment complete' },
    });
    expect(
      sessionView({ number: null, planned: 12, episodeStatus: 'plan_proposed' })?.label,
    ).toBeNull();
    expect(sessionView(undefined)).toBeNull();
  });
});

describe('sessionGate', () => {
  it('is met once the chosen plan is paid: Active or Under review', () => {
    expect(sessionGate('active')).toEqual({ met: true, message: 'Payment complete' });
    expect(sessionGate('under_review').met).toBe(true);
  });

  it('waits for consent and payment before the plan is paid', () => {
    for (const status of ['intake_pending', 'awaiting_consultation', 'plan_proposed'] as const) {
      expect(sessionGate(status)).toEqual({
        met: false,
        message: 'Consent and payment are needed before the first session.',
      });
    }
  });

  it('names an episode that is paused or closed, and a visit outside any episode', () => {
    expect(sessionGate('on_hold').message).toBe('The episode is On hold.');
    expect(sessionGate('discharged').message).toBe('The episode is Discharged.');
    expect(sessionGate('lost_to_follow_up').met).toBe(false);
    expect(sessionGate(null)).toEqual({ met: false, message: 'Not part of an episode yet.' });
  });
});

// SES-03: the session note and what holds Close session back.
describe('the session note', () => {
  const complete = (): SessionNote => ({
    ...emptySessionNote(),
    newSymptoms: { answer: 'no', description: '' },
    pain: { rest: 2, activity: 4, after: 1 },
    treatment: { interventions: ['exercise'], modalities: [], note: '' },
    response: { rating: 'better', note: '' },
    nextSession: { plan: 'progress', note: '' },
  });

  it('reads an empty or partial note with its defaults', () => {
    expect(sessionNoteSchema.parse({})).toEqual(emptySessionNote());
    expect(sessionNoteSchema.parse({ pain: { rest: 3 } }).pain).toEqual({
      rest: 3,
      activity: null,
      after: null,
    });
    expect(sessionNoteSchema.safeParse({ pain: { rest: 11 } }).success).toBe(false);
  });

  it('names everything still missing before it can close, in order', () => {
    expect(sessionNoteBlockers(emptySessionNote())).toEqual([
      'Answer "Any new symptoms?".',
      'Set pain at rest.',
      'Set pain during activity.',
      'Set pain after treatment.',
      'Tick the treatment given.',
      'Choose the response.',
      'Choose what the next session does.',
    ]);
    expect(sessionNoteBlockers(complete())).toEqual([]);
    expect(
      sessionNoteBlockers({ ...complete(), newSymptoms: { answer: 'yes', description: ' ' } }),
    ).toEqual(['Describe the new symptoms.']);
    expect(
      sessionNoteBlockers({
        ...complete(),
        treatment: { interventions: [], modalities: ['pemf'], note: '' },
      }),
    ).toEqual([]);
  });

  it('prefills the treatment from the last signed note, or from the plan the first time', () => {
    const last = {
      ...complete(),
      treatment: { interventions: ['manual_therapy'], modalities: ['laser'], note: 'Grade III' },
    } as SessionNote;
    expect(prefilledSessionNote({ lastNote: last })).toEqual({
      ...emptySessionNote(),
      treatment: last.treatment,
    });
    expect(
      prefilledSessionNote({ plan: { interventions: ['exercise'], modalities: ['pemf'] } })
        .treatment,
    ).toEqual({ interventions: ['exercise'], modalities: ['pemf'], note: '' });
    expect(prefilledSessionNote(undefined)).toEqual(emptySessionNote());
  });
});

describe('a signed session note on the record', () => {
  it('reads a stored note, and one that no longer parses as empty', () => {
    const note = emptySessionNote();
    note.pain.rest = 3;
    expect(readSessionNote(note as unknown as Record<string, unknown>).pain.rest).toBe(3);
    expect(readSessionNote({ pain: { rest: 'high' } })).toEqual(emptySessionNote());
  });

  it('takes an addendum of 1 to 5000 characters on a session', () => {
    const sessionId = '00000000-0000-4000-8000-000000000001';
    expect(sessionAddendumSchema.parse({ sessionId, text: '  Pain was 4 at rest.  ' }).text).toBe(
      'Pain was 4 at rest.',
    );
    expect(sessionAddendumSchema.safeParse({ sessionId, text: '   ' }).success).toBe(false);
    expect(sessionAddendumSchema.safeParse({ sessionId, text: 'x'.repeat(5001) }).success).toBe(
      false,
    );
    expect(sessionAddendumSchema.safeParse({ sessionId: 'nope', text: 'x' }).success).toBe(false);
  });
});
