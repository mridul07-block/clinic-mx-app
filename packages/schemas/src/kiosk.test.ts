import { describe, expect, it } from 'vitest';
import {
  kioskPurposes,
  kioskStateSchema,
  opensOnKiosk,
  sendToKioskSchema,
  setUpKioskSchema,
} from './kiosk';
import { settingDefinitions } from './settings';

const centreId = '00000000-0000-4000-8000-000000000101';

// IAM-10: the clinic tablet shows only patient forms filled in at the clinic.
describe('kiosk', () => {
  it('opens the single use forms and never My plan', () => {
    expect(kioskPurposes).toEqual([
      'health_form',
      'consent',
      'questionnaire',
      'feedback',
      'follow_up',
    ]);
    expect(opensOnKiosk('health_form')).toBe(true);
    expect(opensOnKiosk('my_plan')).toBe(false);
  });

  it('reads its timers from settings', () => {
    expect(settingDefinitions['kiosk.idle_seconds'].schema.parse(120)).toBe(120);
    expect(settingDefinitions['kiosk.thank_you_seconds'].schema.parse(10)).toBe(10);
    expect(() => settingDefinitions['kiosk.idle_seconds'].schema.parse(0)).toThrow();
  });

  it('needs a centre and a name to set a tablet up', () => {
    expect(setUpKioskSchema.parse({ centreId, name: '  Front desk tablet ' })).toEqual({
      centreId,
      name: 'Front desk tablet',
    });
    expect(setUpKioskSchema.safeParse({ centreId, name: '   ' }).success).toBe(false);
    expect(setUpKioskSchema.safeParse({ centreId: 'hsr', name: 'Tablet' }).success).toBe(false);
    expect(setUpKioskSchema.safeParse({ centreId, name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('sends a link by id to a tablet by id', () => {
    expect(sendToKioskSchema.safeParse({ kioskId: centreId, linkId: 'token' }).success).toBe(false);
  });

  it('opens only patient pages from the state the tablet asks for', () => {
    expect(kioskStateSchema.parse({ state: 'open', path: '/p/abc' })).toEqual({
      state: 'open',
      path: '/p/abc',
    });
    expect(kioskStateSchema.safeParse({ state: 'open', path: '/app' }).success).toBe(false);
    expect(kioskStateSchema.safeParse({ state: 'waiting' }).success).toBe(true);
  });
});
