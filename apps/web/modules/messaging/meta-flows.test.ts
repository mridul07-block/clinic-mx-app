import { describe, expect, it, vi } from 'vitest';
import { metaFlowClient, setUpFlow } from './meta-flows';

vi.mock('server-only', () => ({}));

// WA-05: the Flows are set up on Meta by command: created once, their JSON uploaded with Meta's
// validation errors shown, and pointed at this environment's endpoint. The token never goes in a
// URL. Generated ids only.
const config = { accessToken: 'token-123', businessAccountId: '2000', graphVersion: 'v25.0' };

function fakeGraph(answers: Record<string, unknown>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace('/v25.0/', '');
    return Promise.resolve(new Response(JSON.stringify(answers[path] ?? { success: true })));
  });
  return { calls, send };
}

describe('setting a Flow up on Meta', () => {
  it('creates the Flow with its endpoint, then uploads its JSON', async () => {
    const graph = fakeGraph({ '2000/flows': { id: '3000' }, '3000/assets': { success: true } });
    const result = await setUpFlow(metaFlowClient(config, graph.send), {
      kind: 'reschedule',
      origin: 'https://clinic.example/',
      json: '{"version":"6.0"}',
    });
    expect(result).toEqual({ flowId: '3000', created: true, errors: [] });
    expect(graph.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v25.0/2000/flows',
      '/v25.0/3000/assets',
    ]);
    expect(JSON.parse(graph.calls[0]?.init.body as string)).toEqual({
      name: 'Clinic Mx reschedule',
      categories: ['APPOINTMENT_BOOKING'],
      endpoint_uri: 'https://clinic.example/api/flows/reschedule',
    });
    const form = graph.calls[1]?.init.body as FormData;
    expect(form.get('asset_type')).toBe('FLOW_JSON');
    expect(await (form.get('file') as Blob).text()).toBe('{"version":"6.0"}');
    for (const call of graph.calls) {
      expect(call.url).not.toContain('token-123');
      expect(call.init.headers).toMatchObject({ Authorization: 'Bearer token-123' });
    }
  });

  it('updates a Flow it is given, and returns Meta’s validation errors', async () => {
    const graph = fakeGraph({
      '3000/assets': {
        success: true,
        validation_errors: [
          { error: 'INVALID_PROPERTY', message: 'Unknown property', line_start: 12 },
        ],
      },
    });
    const result = await setUpFlow(metaFlowClient(config, graph.send), {
      kind: 'booking',
      origin: 'https://clinic.example',
      json: '{}',
      flowId: '3000',
    });
    expect(result).toEqual({
      flowId: '3000',
      created: false,
      errors: ['line 12: INVALID_PROPERTY: Unknown property'],
    });
    expect(JSON.parse(graph.calls[1]?.init.body as string)).toEqual({
      endpoint_uri: 'https://clinic.example/api/flows/booking',
    });
  });

  it('reports Meta’s refusal, and needs an https origin', async () => {
    const send = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Invalid parameter' } }), { status: 400 }),
      ),
    );
    await expect(
      setUpFlow(metaFlowClient(config, send), {
        kind: 'reschedule',
        origin: 'https://clinic.example',
        json: '{}',
      }),
    ).rejects.toThrow('Creating Clinic Mx reschedule: Invalid parameter');
    await expect(
      setUpFlow(metaFlowClient(config, send), {
        kind: 'reschedule',
        origin: 'http://clinic.example',
        json: '{}',
      }),
    ).rejects.toThrow('The origin must be https.');
  });
});
