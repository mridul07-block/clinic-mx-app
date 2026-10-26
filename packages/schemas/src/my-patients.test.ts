import { describe, expect, it } from 'vitest';
import { loudestAlert, startLabel, startVisitSchema, visitFormStatus } from './my-patients';

const now = new Date('2026-10-24T05:00:00Z');
const later = new Date('2026-10-24T08:00:00Z');

// CLN-01: what each visit on My patients today says.
describe('my patients today', () => {
  it('starts a consultation as one and every other type as a session', () => {
    expect(startLabel('consultation')).toBe('Start consultation');
    expect(startLabel('session')).toBe('Start session');
    expect(startLabel('review')).toBe('Start review');
    expect(startVisitSchema.safeParse({ appointmentId: 'nope' }).success).toBe(false);
  });

  it('shows the form status of a first visit, and none in an open episode', () => {
    const first = { episodeId: null, consentDeclined: false };
    expect(visitFormStatus({ ...first, healthForm: undefined }, now)).toBe('not_sent');
    const waiting = { expiresAt: later, revokedAt: null, completedAt: null };
    expect(visitFormStatus({ ...first, healthForm: waiting }, now)).toBe('waiting');
    expect(visitFormStatus({ ...first, healthForm: waiting, consentDeclined: true }, now)).toBe(
      'declined',
    );
    // Submitting creates the episode; the visit keeps its form, Submitted.
    const submitted = { ...waiting, completedAt: now };
    expect(
      visitFormStatus({ episodeId: 'e', consentDeclined: false, healthForm: submitted }, now),
    ).toBe('submitted');
    expect(
      visitFormStatus({ episodeId: 'e', consentDeclined: false, healthForm: undefined }, now),
    ).toBeUndefined();
  });

  it('gives open alerts the tone of the loudest', () => {
    expect(loudestAlert([])).toBeUndefined();
    expect(loudestAlert(['information', 'review'])).toBe('review');
    expect(loudestAlert(['review', 'emergency'])).toBe('emergency');
  });
});
