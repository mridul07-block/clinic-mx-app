import { describe, expect, it } from 'vitest';
import {
  emptySessionNote,
  prefilledSessionNote,
  readSessionNote,
  sameAsLastTime,
  sameAsLastTimeOverwrites,
  sessionAddendumSchema,
  sessionGate,
  sessionLabel,
  sessionNoteBlockers,
  sessionNoteDigest,
  sessionParameterLine,
  sessionNoteSchema,
  sessionView,
  type SessionModality,
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
    expect(sessionView({ number: 2, planned: 12, episodeStatus: 'active', partB: 'met' })).toEqual({
      label: 'Session 2 of 12',
      gate: { met: true, message: 'Consent and payment complete' },
    });
    expect(
      sessionView({ number: null, planned: 12, episodeStatus: 'plan_proposed' })?.label,
    ).toBeNull();
    expect(sessionView(undefined)).toBeNull();
  });
});

describe('sessionGate', () => {
  it('is met once the chosen plan is paid and Part B consent is met (BIL-12)', () => {
    expect(sessionGate('active', 'met')).toEqual({
      met: true,
      message: 'Consent and payment complete',
    });
    expect(sessionGate('under_review', 'met').met).toBe(true);
    // A patient already in treatment before launch: consent on paper.
    expect(sessionGate('active', 'opening_entry').met).toBe(true);
  });

  it('waits for Part B once paid, saying why', () => {
    expect(sessionGate('active', 'missing')).toEqual({
      met: false,
      message: 'Part B consent is needed.',
    });
    expect(sessionGate('active', 'general_declined').message).toContain('No treatment');
    expect(sessionGate('active', 'package_declined').met).toBe(false);
    expect(sessionGate('active', null).met).toBe(false);
  });

  it('waits for consent and payment before the plan is paid', () => {
    for (const status of ['intake_pending', 'awaiting_consultation', 'plan_proposed'] as const) {
      expect(sessionGate(status, 'met')).toEqual({
        met: false,
        message: 'Consent and payment are needed before the first session.',
      });
    }
  });

  it('names an episode that is paused or closed, and a visit outside any episode', () => {
    expect(sessionGate('on_hold', 'met').message).toBe('The episode is On hold.');
    expect(sessionGate('discharged', 'met').message).toBe('The episode is Discharged.');
    expect(sessionGate('lost_to_follow_up', 'met').met).toBe(false);
    expect(sessionGate(null, null)).toEqual({ met: false, message: 'Not part of an episode yet.' });
  });
});

// SES-03: the session note and what holds Close session back.
describe('the session note', () => {
  const complete = (): SessionNote => ({
    ...emptySessionNote(),
    newSymptoms: { answer: 'no', description: '' },
    pain: { rest: 2, activity: 4, after: 1 },
    treatment: {
      interventions: ['exercise'],
      modalities: [],
      note: '',
      parameters: {},
      reasons: {},
    },
    response: { rating: 'better', note: '', adverseEvent: { reported: false, description: '' } },
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
        treatment: {
          interventions: [],
          modalities: ['pemf'],
          note: '',
          parameters: {},
          reasons: {},
        },
      }),
    ).toEqual([]);
  });

  it('prefills the treatment from the last signed note, or from the plan the first time', () => {
    const last = {
      ...complete(),
      treatment: {
        interventions: ['manual_therapy'],
        modalities: ['laser'],
        note: 'Grade III',
        parameters: { laser: { area: 'Achilles', duration: '8' } },
        reasons: { laser: 'Asked again' },
      },
    } as SessionNote;
    // SES-05: the parameters come along; a precaution's reason is asked again.
    expect(prefilledSessionNote({ lastNote: last })).toEqual({
      ...emptySessionNote(),
      treatment: { ...last.treatment, reasons: {} },
    });
    expect(
      prefilledSessionNote({ plan: { interventions: ['exercise'], modalities: ['pemf'] } })
        .treatment,
    ).toEqual({
      interventions: ['exercise'],
      modalities: ['pemf'],
      note: '',
      parameters: {},
      reasons: {},
    });
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

// SES-04 done when: "Same as last time" copies the previous note for editing. Decisions (user, 26
// October 2026): the plan side only; confirm before replacing what was entered.
describe('Same as last time', () => {
  const last = (): SessionNote => ({
    ...emptySessionNote(),
    newSymptoms: { answer: 'yes', description: 'Tingling' },
    sinceLastVisit: 'Stairs easier',
    pain: { rest: 2, activity: 4, after: 1 },
    treatment: {
      interventions: ['exercise', 'manual_therapy'],
      modalities: ['pemf'],
      note: 'Grade III',
      parameters: {},
      reasons: {},
    },
    response: {
      rating: 'better',
      note: 'Moving well',
      adverseEvent: { reported: false, description: '' },
    },
    homeProgramme: { note: 'Add step downs' },
    nextSession: { plan: 'progress', note: 'Add load' },
  });

  it('copies the treatment, home programme changes and next session, and nothing of today', () => {
    const today: SessionNote = {
      ...emptySessionNote(),
      newSymptoms: { answer: 'no', description: '' },
      pain: { rest: 5, activity: null, after: null },
    };
    const copied = sameAsLastTime(today, last());
    expect(copied.treatment).toEqual(last().treatment);
    expect(copied.homeProgramme).toEqual({ note: 'Add step downs' });
    expect(copied.nextSession).toEqual({ plan: 'progress', note: 'Add load' });
    expect(copied.newSymptoms).toEqual({ answer: 'no', description: '' });
    expect(copied.sinceLastVisit).toBe('');
    expect(copied.pain).toEqual({ rest: 5, activity: null, after: null });
    expect(copied.response).toEqual(emptySessionNote().response);
    // Copies, not the same arrays.
    expect(copied.treatment.interventions).not.toBe(last().treatment.interventions);
  });

  it('asks before replacing only what the physio entered in those sections', () => {
    const opened = prefilledSessionNote({ lastNote: last() });
    expect(sameAsLastTimeOverwrites(opened, last()), 'as it opened').toBe(false);
    expect(
      sameAsLastTimeOverwrites({ ...opened, pain: { rest: 3, activity: 3, after: 3 } }, last()),
      'today’s fields are not replaced',
    ).toBe(false);
    expect(sameAsLastTimeOverwrites(sameAsLastTime(opened, last()), last()), 'already copied').toBe(
      false,
    );
    expect(
      sameAsLastTimeOverwrites(
        { ...opened, treatment: { ...opened.treatment, note: 'Taped the knee' } },
        last(),
      ),
    ).toBe(true);
    expect(
      sameAsLastTimeOverwrites({ ...opened, nextSession: { plan: 'regress', note: '' } }, last()),
    ).toBe(true);
  });
});

// SES-06 done when: an adverse event requires a description and alerts the consultant. Decisions
// (user, 26 October 2026): an optional tick under the response; its description only.
describe('an adverse event', () => {
  it('is not reported on a note written before it existed', () => {
    const old = sessionNoteSchema.parse({ response: { rating: 'better', note: '' } });
    expect(old.response.adverseEvent).toEqual({ reported: false, description: '' });
    expect(emptySessionNote().response.adverseEvent.reported).toBe(false);
  });

  it('holds Close session back until it is described, and is never copied', () => {
    const note: SessionNote = {
      ...emptySessionNote(),
      newSymptoms: { answer: 'no', description: '' },
      pain: { rest: 2, activity: 4, after: 1 },
      treatment: {
        interventions: ['exercise'],
        modalities: [],
        note: '',
        parameters: {},
        reasons: {},
      },
      response: { rating: 'worse', note: '', adverseEvent: { reported: true, description: '  ' } },
      nextSession: { plan: 'regress', note: '' },
    };
    expect(sessionNoteBlockers(note)).toEqual(['Describe the adverse event.']);
    note.response.adverseEvent.description = 'Dizzy after shockwave, settled in 10 minutes';
    expect(sessionNoteBlockers(note)).toEqual([]);
    expect(sameAsLastTime(emptySessionNote(), note).response.adverseEvent.reported).toBe(false);
    expect(
      sessionNoteSchema.safeParse({
        response: { adverseEvent: { reported: true, description: 'x'.repeat(2001) } },
      }).success,
    ).toBe(false);
  });
});

// The one line a signed session note shows on the record's Notes (CLN-12 follow up), naming an
// adverse event (SES-06).
describe('sessionNoteDigest', () => {
  it('reads the pain, the response and an adverse event', () => {
    const note = emptySessionNote();
    expect(sessionNoteDigest(note)).toBe('');
    note.pain = { rest: 2, activity: 4, after: 1 };
    note.response.rating = 'worse';
    expect(sessionNoteDigest(note)).toBe(
      'Pain 2 at rest · 4 during activity · 1 after treatment · Worse',
    );
    note.response.adverseEvent = { reported: true, description: 'Dizzy after shockwave' };
    expect(sessionNoteDigest(note)).toBe(
      'Pain 2 at rest · 4 during activity · 1 after treatment · Worse · Adverse event',
    );
  });
});

// SES-05 done when: each modality has its parameter fields, and a precaution warns when relevant.
// Decisions (user, 26 October 2026): the fields filled before closing; a reason for a warned
// modality; parameters carried over, the reason asked again.
describe('modality parameters', () => {
  const shockwave: SessionModality = {
    key: 'radial_shockwave',
    name: 'Radial Shockwave (RSW)',
    parameters: [
      { key: 'area', label: 'Area treated', kind: 'text', source: 's' },
      { key: 'duration', label: 'Duration', kind: 'number', unit: 'min', source: 's' },
      { key: 'frequency', label: 'Frequency', kind: 'number', unit: 'Hz', source: 's' },
    ],
    warnings: [{ label: 'Pregnancy', source: 'SOP 12.3' }],
  };
  const laser: SessionModality = { ...shockwave, key: 'laser', name: 'Laser', warnings: [] };
  const ready = (): SessionNote => ({
    ...emptySessionNote(),
    newSymptoms: { answer: 'no', description: '' },
    pain: { rest: 2, activity: 4, after: 1 },
    treatment: {
      interventions: [],
      modalities: ['radial_shockwave'],
      note: '',
      parameters: { radial_shockwave: { area: 'Achilles', duration: '10', frequency: '8' } },
      reasons: { radial_shockwave: 'Second trimester excluded by the obstetrician' },
    },
    response: { rating: 'better', note: '', adverseEvent: { reported: false, description: '' } },
    nextSession: { plan: 'progress', note: '' },
  });

  it('needs each ticked modality’s parameters, as numbers where they are numbers', () => {
    expect(sessionNoteBlockers(ready(), [shockwave, laser])).toEqual([]);
    const blank = ready();
    blank.treatment.parameters.radial_shockwave = {
      area: 'Achilles',
      duration: '',
      frequency: '8',
    };
    expect(sessionNoteBlockers(blank, [shockwave])).toEqual([
      'Fill the parameters for Radial Shockwave (RSW).',
    ]);
    const words = ready();
    words.treatment.parameters.radial_shockwave = {
      area: 'Achilles',
      duration: 'ten',
      frequency: '8',
    };
    expect(sessionNoteBlockers(words, [shockwave])).toEqual([
      'Fill the parameters for Radial Shockwave (RSW).',
    ]);
    // Without the note's modalities nothing more is asked (an older note's version has none).
    expect(sessionNoteBlockers(blank)).toEqual([]);
    // An unticked modality asks for nothing.
    const unticked = {
      ...ready(),
      treatment: { ...ready().treatment, interventions: ['exercise' as const], modalities: [] },
    };
    expect(sessionNoteBlockers(unticked, [shockwave])).toEqual([]);
  });

  it('needs a reason for a modality that warns about a precaution', () => {
    const note = ready();
    note.treatment.reasons = {};
    expect(sessionNoteBlockers(note, [shockwave])).toEqual([
      'Give a reason for Radial Shockwave (RSW) despite Pregnancy.',
    ]);
    expect(sessionNoteBlockers(note, [{ ...shockwave, warnings: [] }])).toEqual([]);
  });

  it('carries the parameters into Same as last time, keeping today’s reasons', () => {
    const today = {
      ...emptySessionNote(),
      treatment: { ...emptySessionNote().treatment, reasons: { radial_shockwave: 'Today' } },
    };
    const copied = sameAsLastTime(today, ready());
    expect(copied.treatment.parameters).toEqual(ready().treatment.parameters);
    expect(copied.treatment.reasons).toEqual({ radial_shockwave: 'Today' });
    expect(copied.treatment.parameters).not.toBe(ready().treatment.parameters);
  });

  it('reads the parameters in one line with their units', () => {
    expect(
      sessionParameterLine(ready().treatment.parameters.radial_shockwave, shockwave.parameters),
    ).toBe('Achilles · 10 min · 8 Hz');
    expect(sessionParameterLine(undefined, shockwave.parameters)).toBe('');
  });
});
