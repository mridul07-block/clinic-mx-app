import { randomBytes, randomInt } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';
import { afterAll, describe, expect, it } from 'vitest';
import { monitoringOptions } from './options';
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './scrub';

// Generated fake details only (rule 12), fresh on every run.
const digits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');
const fake = () => ({
  name: `Test Patient ${digits(4)}`,
  phone: `9${digits(9)}`,
  spacedPhone: `+91 9${digits(4)} ${digits(5)}`,
  patientNumber: `MVH-${digits(5)}`,
  email: `test.${digits(5)}@example.com`,
  id: crypto.randomUUID(),
  token: randomBytes(24).toString('base64url'),
});

describe('scrubText', () => {
  const f = fake();

  it.each([
    ['an email address', `no staff for ${f.email}`, f.email],
    ['a phone number', `sending to ${f.phone} failed`, f.phone],
    ['a spaced phone number with +91', `sending to ${f.spacedPhone} failed`, f.spacedPhone],
    ['a patient number', `no record ${f.patientNumber}`, f.patientNumber],
    ['an id', `appointment ${f.id} not found`, f.id],
    ['a link token', `bad link ${f.token}`, f.token],
    ['a quoted value', `invalid input syntax for type uuid: "${f.name}"`, f.name],
    ['a single quoted value', `cannot read '${f.name}'`, f.name],
  ])('removes %s', (_, text, planted) => {
    const scrubbed = scrubText(text);
    expect(scrubbed).not.toContain(planted);
    expect(scrubbed).toContain('[scrubbed]');
  });

  it('cuts everything after a failed query lists its params (Drizzle)', () => {
    const text = `Failed query: insert into "patient" ("full_name", "phone") values ($1, $2)\nparams: ${f.name},${f.phone}`;
    const scrubbed = scrubText(text);
    expect(scrubbed).toContain('Failed query: insert into');
    expect(scrubbed).toContain('params: [scrubbed]');
    expect(scrubbed).not.toContain(f.name);
  });

  it('removes the value from a Postgres key detail', () => {
    const scrubbed = scrubText(`Key (phone)=(${f.phone}) already exists.`);
    expect(scrubbed).toBe('Key (phone)=([scrubbed]) already exists.');
  });

  it('keeps plain error text', () => {
    expect(scrubText('Cannot read properties of undefined')).toBe(
      'Cannot read properties of undefined',
    );
  });
});

describe('scrubUrl', () => {
  const f = fake();

  it('keeps a patient link as /p/[token], without its query or fragment', () => {
    expect(scrubUrl(`https://clinic.example/p/${f.token}?phone=${f.phone}#top`)).toBe(
      'https://clinic.example/p/[token]',
    );
  });

  it('replaces ids in staff addresses and drops the query', () => {
    expect(scrubUrl(`/app/patients/${f.id}?q=${f.name}`)).toBe('/app/patients/[id]');
  });

  it('keeps a transaction name readable', () => {
    expect(scrubUrl('GET /app/patients/[patientId]')).toBe('GET /app/patients/[patientId]');
  });
});

describe('scrubBreadcrumb', () => {
  const f = fake();

  it('drops console lines', () => {
    expect(scrubBreadcrumb({ category: 'console', message: f.name })).toBeNull();
  });

  it('keeps only where and how for requests', () => {
    const crumb: Breadcrumb = {
      category: 'fetch',
      data: { url: `/p/${f.token}?x=${f.phone}`, method: 'POST', status_code: 500, body: f.name },
    };
    expect(scrubBreadcrumb(crumb)).toEqual({
      category: 'fetch',
      data: { url: '/p/[token]', method: 'POST', status_code: 500 },
    });
  });
});

describe('scrubEvent', () => {
  const f = fake();

  it('removes who asked, what was sent, local values and extras', () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { email: f.email, ip_address: '203.0.113.9' },
      extra: { patient: f.name },
      request: {
        url: `https://clinic.example/p/${f.token}?phone=${f.phone}`,
        method: 'POST',
        cookies: { session: f.token },
        headers: { 'x-patient': f.name },
        data: { phone: f.phone },
        query_string: `phone=${f.phone}`,
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: `Key (phone)=(${f.phone}) already exists for "${f.name}"`,
            stacktrace: { frames: [{ function: 'save', vars: { phone: f.phone } }] },
          },
        ],
      },
      tags: { note: f.email },
      contexts: { app: { patient: f.patientNumber } },
    };
    const scrubbed = JSON.stringify(scrubEvent(event));
    for (const planted of Object.values(f)) expect(scrubbed).not.toContain(planted);
    expect(scrubbed).not.toContain('203.0.113.9');
    expect(scrubbed).toContain('"type":"Error"');
    expect(scrubbed).toContain('"function":"save"');
  });
});

// The whole path with the options every runtime uses: a real Sentry client, sending to a
// recording transport instead of Sentry.
describe('an error report as sent', () => {
  const sent: string[] = [];
  const decoder = new TextDecoder();
  Sentry.init({
    ...monitoringOptions({
      dsn: 'https://public@o0.ingest.de.sentry.io/0',
      environment: 'test',
      release: 'test',
    }),
    transport: (options: Parameters<typeof Sentry.createTransport>[0]) =>
      Sentry.createTransport(options, (request) => {
        sent.push(typeof request.body === 'string' ? request.body : decoder.decode(request.body));
        return Promise.resolve({ statusCode: 200 });
      }),
  });
  afterAll(() => Sentry.close());

  it('keeps the error and its stack, never the patient details', async () => {
    const f = fake();
    Sentry.setUser({ email: f.email });
    Sentry.setExtra('patient', f.name);
    Sentry.addBreadcrumb({ category: 'console', message: `${f.name} ${f.phone}` });
    Sentry.addBreadcrumb({ category: 'fetch', data: { url: `/p/${f.token}?p=${f.phone}` } });
    const cause = new Error(`Key (phone)=(${f.spacedPhone}) already exists.`);
    const error = new Error(
      `Failed query: insert into "patient" ("full_name", "phone") values ($1, $2)\nparams: ${f.name},${f.phone}`,
      { cause },
    );
    Sentry.captureException(error);
    Sentry.captureMessage(`No patient ${f.patientNumber} for ${f.email} at ${f.id}`);
    await Sentry.flush(2000);

    const body = sent.join('\n');
    expect(body).toContain('Failed query: insert into');
    expect(body).toContain('scrub.test.ts');
    expect(body).toContain('No patient [scrubbed]');
    for (const planted of Object.values(f)) expect(body).not.toContain(planted);
  });
});
