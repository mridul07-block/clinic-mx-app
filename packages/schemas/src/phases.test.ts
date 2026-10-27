import { describe, expect, it } from 'vitest';
import {
  painLimitHint,
  phaseLine,
  phaseOverrideSchema,
  phaseStepper,
  progressRefusal,
  type PhaseCriterion,
  type PhaseMove,
  type ProgrammePhase,
} from './phases';

const phase = (number: number, name: string): ProgrammePhase => ({
  region: 'knee',
  number,
  name,
  timing: '',
  goal: '',
  content: '',
  markers: '',
});
const phases = [
  phase(0, 'Screen & Protect'),
  phase(1, 'Restore & Activate'),
  phase(2, 'Build Capacity'),
];
const line = (phaseNumber: number, position: number, text: string): PhaseCriterion => ({
  key: `knee.phase${String(phaseNumber)}.line_${String(position)}`,
  region: 'knee',
  phase: phaseNumber,
  position,
  text,
  namesPainLimit: false,
});
const criteria = [
  line(0, 0, 'Effusion controlled'),
  line(0, 1, 'straight leg raise without lag'),
  line(1, 0, 'pain <=5/10 on loading settling within 24 h'),
];
const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 4, minute));
const move = (fromPhase: number, toPhase: number, minute: number): PhaseMove => ({
  fromPhase,
  toPhase,
  kind: 'override',
  reason: 'Already settled.',
  movedAt: at(minute),
  movedByName: 'Dr Test Consultant',
});

// OUT-04 (user decisions 27 October 2026): Phase 0 first; the next phase unlocks when every exit
// criterion of the current one is marked Met since it was entered; a consultant moves it anywhere.
describe('the phase stepper', () => {
  it('starts in Phase 0 with the next phase locked by its unmet lines, in words', () => {
    const stepper = phaseStepper(phases, criteria, [], []);
    expect(stepper.current).toBe(0);
    expect(stepper.phases.map((p) => p.state)).toEqual(['current', 'locked', 'locked']);
    expect(stepper.phases[1]?.lockedBecause).toEqual([
      'Phase 0: Effusion controlled',
      'Phase 0: straight leg raise without lag',
    ]);
    expect(stepper.phases[2]?.lockedBecause).toEqual(['Phase 1 comes first.']);
    expect(progressRefusal(stepper)).toBe('Mark every exit criterion of this phase Met first.');
    expect(phaseLine(stepper)).toBe('Phase 0 of 2: Screen & Protect');
  });

  it('unlocks when every line is Met by its latest mark', () => {
    const marks = [
      { criterionKey: 'knee.phase0.line_0', result: 'met' as const, markedAt: at(1) },
      { criterionKey: 'knee.phase0.line_1', result: 'met' as const, markedAt: at(2) },
      { criterionKey: 'knee.phase0.line_1', result: 'not_yet' as const, markedAt: at(3) },
    ];
    const stepper = phaseStepper(phases, criteria, marks, []);
    expect(stepper.phases[0]?.lines.map((l) => l.result)).toEqual(['met', 'not_yet']);
    expect(stepper.unmet).toEqual(['straight leg raise without lag']);
    const marked = [
      ...marks,
      { criterionKey: 'knee.phase0.line_1', result: 'met' as const, markedAt: at(4) },
    ];
    const ready = phaseStepper(phases, criteria, marked, []);
    expect(progressRefusal(ready)).toBeNull();
    expect(ready.phases[1]?.lockedBecause).toEqual([
      'Every exit criterion of Phase 0 is Met: ready to move on.',
    ]);
  });

  it('counts only the marks since the phase was entered, and ends at the last phase', () => {
    const marks = [
      { criterionKey: 'knee.phase0.line_0', result: 'met' as const, markedAt: at(1) },
      { criterionKey: 'knee.phase0.line_1', result: 'met' as const, markedAt: at(2) },
    ];
    // Overridden to Phase 2, then back to Phase 0: the earlier marks no longer count.
    const back = phaseStepper(phases, criteria, marks, [move(0, 2, 5), move(2, 0, 6)]);
    expect(back.current).toBe(0);
    expect(back.phases[0]?.lines.map((l) => l.result)).toEqual([null, null]);
    const last = phaseStepper(phases, criteria, [], [move(0, 2, 5)]);
    expect(last.phases.map((p) => p.state)).toEqual(['skipped', 'skipped', 'current']);
    expect(progressRefusal(last)).toBe('This is the last phase.');
    expect(phaseLine(last)).toBe('Phase 2 of 2: Build Capacity');
  });

  it('needs a reason for an override, and words the pain hint against the setting', () => {
    const episodeId = '00000000-0000-4000-8000-000000000501';
    expect(
      phaseOverrideSchema.safeParse({ episodeId, toPhase: 2, reason: ' ' }).error?.issues[0]
        ?.message,
    ).toBe('Say why the phase is moved.');
    expect(painLimitHint(5, { value: 3, session: 4 })).toBe(
      'Acceptable exercise pain is up to 5/10 (clinic setting). Latest pain during activity: 3/10 at session 4.',
    );
    expect(painLimitHint(4, null)).toBe(
      'Acceptable exercise pain is up to 4/10 (clinic setting). No session pain during activity recorded yet.',
    );
  });
});
