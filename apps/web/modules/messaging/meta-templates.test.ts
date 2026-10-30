import type { Db } from '@clinic-mx/db';
import { messageTemplate } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  metaTemplateClient,
  samplePdf,
  submitTemplates,
  syncTemplates,
  type MetaTemplateClient,
} from './meta-templates';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({ recordTemplateVersion: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));

const templates = [
  messageTemplate('no_show'),
  messageTemplate('receipt'),
  messageTemplate('day_before_reminder'),
  messageTemplate('morning_reminder'),
];
const fakeMeta = (onMeta: Awaited<ReturnType<MetaTemplateClient['list']>>) => ({
  list: vi.fn(() => Promise.resolve(structuredClone(onMeta))),
  uploadSample: vi.fn(() => Promise.resolve('handle-1')),
  create: vi.fn((body: { name: string }) =>
    Promise.resolve({ id: ['id', body.name].join('-'), status: 'PENDING', category: 'UTILITY' }),
  ),
});
const recorded = () => db.recordTemplateVersion.mock.calls.map((call) => call[1] as unknown);

// WA-06 done when: every template in the TAD list is submitted and approved on the test number.
describe('submitting the templates to Meta', () => {
  beforeEach(() => db.recordTemplateVersion.mockReset());

  it('creates each version Meta lacks, once, leaving out a held one, and records them all', async () => {
    const meta = fakeMeta([
      {
        id: 'id-morning',
        name: 'morning_reminder_v1',
        language: 'en',
        status: 'APPROVED',
        category: 'UTILITY',
      },
      // Meta's sample on every test number: not ours, never recorded.
      {
        id: 'id-hello',
        name: 'hello_world',
        language: 'en_US',
        status: 'APPROVED',
        category: 'UTILITY',
      },
    ]);
    const results = await submitTemplates(
      {} as Db,
      meta,
      {
        origin: 'https://clinic.example',
        samplePdf,
      },
      templates,
    );
    expect(results).toEqual([
      { key: 'no_show', version: 1, status: 'pending', outcome: 'submitted' },
      { key: 'receipt', version: 1, status: 'pending', outcome: 'submitted' },
      { key: 'day_before_reminder', version: 1, status: 'held', outcome: 'held' },
      { key: 'morning_reminder', version: 1, status: 'approved', outcome: 'on_meta' },
    ]);
    // One sample PDF, for the receipt's document header.
    expect(meta.uploadSample).toHaveBeenCalledTimes(1);
    expect(meta.create.mock.calls.map(([body]) => body.name)).toEqual(['no_show_v1', 'receipt_v1']);
    expect(meta.create.mock.calls[1]?.[0]).toMatchObject({
      components: [{ type: 'HEADER', example: { header_handle: ['handle-1'] } }, { type: 'BODY' }],
    });
    expect(recorded()).toEqual([
      {
        key: 'morning_reminder',
        version: 1,
        language: 'en',
        metaName: 'morning_reminder_v1',
        metaId: 'id-morning',
        category: 'UTILITY',
        status: 'approved',
        reason: null,
      },
      expect.objectContaining({ key: 'no_show', metaId: 'id-no_show_v1', status: 'pending' }),
      expect.objectContaining({ key: 'receipt', metaId: 'id-receipt_v1', status: 'pending' }),
    ]);
  });

  it('submits nothing twice and uploads no sample when every version is on Meta', async () => {
    const meta = fakeMeta(
      ['no_show_v1', 'receipt_v1', 'morning_reminder_v1'].map((name) => ({
        id: ['id', name].join('-'),
        name,
        language: 'en',
        status: 'PENDING',
        category: 'UTILITY',
      })),
    );
    await submitTemplates(
      {} as Db,
      meta,
      { origin: 'https://clinic.example', samplePdf },
      templates,
    );
    expect(meta.create).not.toHaveBeenCalled();
    expect(meta.uploadSample).not.toHaveBeenCalled();
  });

  it('syncs Meta’s verdicts, rejection reasons and older versions', async () => {
    const meta = fakeMeta([
      {
        id: '1',
        name: 'no_show_v1',
        language: 'en',
        status: 'REJECTED',
        category: 'UTILITY',
        rejected_reason: 'INVALID_FORMAT',
      },
      { id: '2', name: 'no_show_v2', language: 'en', status: 'APPROVED', category: 'UTILITY' },
      { id: '3', name: 'unknown_key_v1', language: 'en', status: 'APPROVED', category: 'UTILITY' },
    ]);
    expect(await syncTemplates({} as Db, meta)).toBe(2);
    expect(recorded()).toEqual([
      expect.objectContaining({ version: 1, status: 'rejected', reason: 'INVALID_FORMAT' }),
      expect.objectContaining({ version: 2, status: 'approved', reason: null }),
    ]);
  });
});

describe('the Meta client', () => {
  const config = { accessToken: 'fake-token', businessAccountId: '222', graphVersion: 'v25.0' };
  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('follows Meta’s pages and never puts the token in a URL', async () => {
    const send = vi
      .fn()
      .mockReturnValueOnce(
        json(200, {
          data: [{ id: '1', name: 'a_v1', language: 'en', status: 'PENDING', category: 'UTILITY' }],
          paging: { next: 'https://graph.facebook.com/v25.0/222/message_templates?after=x' },
        }),
      )
      .mockReturnValueOnce(json(200, { data: [] }));
    expect(await metaTemplateClient(config, send).list()).toHaveLength(1);
    for (const [url] of send.mock.calls as [string][]) expect(url).not.toContain('fake-token');
  });

  it('reports Meta’s message for a refusal, nothing of the request', async () => {
    const send = vi.fn(() =>
      json(400, { error: { message: 'Invalid parameter', error_user_msg: 'Body is too long' } }),
    );
    await expect(
      metaTemplateClient(config, send).create({
        name: 'no_show_v1',
        language: 'en',
        category: 'UTILITY',
        components: [],
      }),
    ).rejects.toThrow('Creating no_show_v1: Body is too long');
  });

  it('makes a one page sample PDF', () => {
    const text = new TextDecoder().decode(samplePdf());
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 1');
  });
});
