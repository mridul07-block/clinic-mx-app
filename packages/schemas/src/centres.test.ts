import { describe, expect, it } from 'vitest';
import {
  centreColourIndex,
  centreColourName,
  centreColours,
  centreDetailsSchema,
  formatIndianPhone,
  indianPhoneSchema,
  mapLinkSchema,
} from './centres';

const details = {
  name: 'HSR Layout',
  address: '17/N, 18th Main Rd, Sector 3, HSR Layout, Bengaluru 560102',
  phone: '080 4123 4567',
  mapLink: 'https://maps.app.goo.gl/abc123',
  colour: '#2F74BB',
};

// SET-01: address, map link, phone and chart colour per centre.
describe('centre details', () => {
  it('store phones as +91 and 10 digits, however they are typed', () => {
    for (const typed of [
      '9845012345',
      '98450 12345',
      '+91 98450 12345',
      '+91-98450-12345',
      '09845012345',
      '919845012345',
    ]) {
      expect(indianPhoneSchema.parse(typed), typed).toBe('+919845012345');
    }
    expect(indianPhoneSchema.parse('080 4123 4567')).toBe('+918041234567');
    expect(indianPhoneSchema.parse('(080) 4123-4567')).toBe('+918041234567');
  });

  it('refuse what is not a 10 digit Indian number', () => {
    for (const typed of ['', '12345', '98450 1234', '+1 415 555 0100', '0000000000', 'call us']) {
      expect(indianPhoneSchema.safeParse(typed).success, typed).toBe(false);
    }
  });

  it('show phones the way people read them', () => {
    expect(formatIndianPhone('+919845012345')).toBe('+91 98450 12345');
    expect(formatIndianPhone('+918041234567')).toBe('+91 80 4123 4567');
    expect(formatIndianPhone('not stored by us')).toBe('not stored by us');
  });

  it('take only https Google Maps links', () => {
    for (const link of [
      'https://maps.app.goo.gl/abc123',
      'https://goo.gl/maps/abc123',
      'https://www.google.com/maps/place/Movementology',
      'https://google.com/maps?q=12.9,77.6',
      'https://maps.google.com/?cid=123',
    ]) {
      expect(mapLinkSchema.safeParse(link).success, link).toBe(true);
    }
    for (const link of [
      'http://maps.app.goo.gl/abc123',
      'https://maps.app.goo.gl.example.com/abc',
      'https://www.google.com/search?q=clinic',
      'https://goo.gl/abc',
      'https://user:pass@maps.google.com/',
      'javascript:alert(1)',
      'maps.app.goo.gl/abc',
    ]) {
      expect(mapLinkSchema.safeParse(link).success, link).toBe(false);
    }
  });

  it('choose the chart colour from the design system’s centre colours', () => {
    expect(centreColours.map((c) => c.name)).toEqual(['Blue', 'Violet', 'Teal']);
    expect(centreColourName('#7F5BB6')).toBe('Violet');
    expect(centreColourIndex('#1C8580')).toBe(2);
    expect(centreColourIndex('#000000')).toBe(-1);
    expect(centreDetailsSchema.safeParse({ ...details, colour: '#FF0000' }).success).toBe(false);
  });

  it('need every detail, trimmed', () => {
    expect(centreDetailsSchema.parse({ ...details, name: '  HSR Layout ' })).toEqual({
      ...details,
      phone: '+918041234567',
    });
    for (const field of ['name', 'address', 'phone', 'mapLink', 'colour'] as const) {
      expect(centreDetailsSchema.safeParse({ ...details, [field]: '' }).success, field).toBe(false);
    }
    expect(centreDetailsSchema.safeParse({ ...details, name: 'x'.repeat(61) }).success).toBe(false);
  });
});
