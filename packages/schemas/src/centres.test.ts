import { describe, expect, it } from 'vitest';
import {
  formatMapCoordinates,
  mapCoordinatesSchema,
  centreColourIndex,
  centreColourName,
  centreColours,
  centreDetailsSchema,
  formatIndianPhone,
  indianPhoneSchema,
  mapLinkSchema,
  reviewLinkSchema,
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
      // Optional: none given, none kept.
      coordinates: null,
    });
    for (const field of ['name', 'address', 'phone', 'mapLink', 'colour'] as const) {
      expect(centreDetailsSchema.safeParse({ ...details, [field]: '' }).success, field).toBe(false);
    }
    expect(centreDetailsSchema.safeParse({ ...details, name: 'x'.repeat(61) }).success).toBe(false);
  });
});

// PAT-09: the centre's Google review link, sent to every discharged patient.
describe('the review link', () => {
  it('takes an https Google review link, and nothing else', () => {
    for (const link of [
      'https://g.page/r/TestOnlyReview123/review',
      'https://search.google.com/local/writereview?placeid=TestOnly',
      'https://maps.app.goo.gl/TestOnly123',
      'https://www.google.com/maps/place/TestOnly',
    ]) {
      expect(reviewLinkSchema.safeParse(link).success, link).toBe(true);
    }
    for (const link of [
      'http://g.page/r/TestOnlyReview123/review',
      'https://example.com/review',
      'https://user:pass@g.page/r/x',
      'g.page/r/TestOnlyReview123',
      'https://www.google.com/mail',
    ]) {
      expect(reviewLinkSchema.safeParse(link).success, link).toBe(false);
    }
  });

  it('is optional: empty clears it, left out keeps it', () => {
    const details = {
      name: 'HSR Layout',
      address: 'Test address',
      phone: '080 4123 4567',
      mapLink: 'https://maps.app.goo.gl/TestOnly123',
      colour: '#2F74BB',
    };
    const parsed = (reviewLink?: string) =>
      centreDetailsSchema.safeParse({
        ...details,
        ...(reviewLink === undefined ? {} : { reviewLink }),
      });
    expect(parsed('').data?.reviewLink).toBeNull();
    expect(parsed().data?.reviewLink).toBeUndefined();
    expect(parsed(' https://g.page/r/TestOnlyReview123/review ').data?.reviewLink).toBe(
      'https://g.page/r/TestOnlyReview123/review',
    );
    expect(parsed('https://example.com').success).toBe(false);
  });
});

// The map in WhatsApp's booking confirmation (user decision, 1 November 2026).
describe('map coordinates', () => {
  it('take them as Google Maps shows them, and show them back the same way', () => {
    expect(mapCoordinatesSchema.parse('12.9116, 77.6474')).toEqual({
      latitude: 12.9116,
      longitude: 77.6474,
    });
    expect(mapCoordinatesSchema.parse(' 12.91161234,77.64749999 ')).toEqual({
      latitude: 12.911612,
      longitude: 77.6475,
    });
    expect(mapCoordinatesSchema.parse('-33.8688, 151.2093')).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(formatMapCoordinates(12.9116, 77.6474)).toBe('12.9116, 77.6474');
    expect(formatMapCoordinates(null, null)).toBe('');
  });

  it('are optional, and refuse anything else', () => {
    expect(mapCoordinatesSchema.parse('')).toBeNull();
    expect(mapCoordinatesSchema.parse(undefined)).toBeNull();
    for (const bad of ['12.9116', '91, 77', '12.9, 181', 'HSR Layout', '12.9; 77.6']) {
      expect(mapCoordinatesSchema.safeParse(bad).success).toBe(false);
    }
  });
});
