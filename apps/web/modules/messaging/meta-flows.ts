import 'server-only';
import { z } from 'zod';
import { MetaTemplateError, graph, metaJson, type MetaConfig } from './meta-templates';

/**
 * Setting a WhatsApp Flow up on Meta (WA-04, WA-05; docs/runbooks/whatsapp.md, "Setting the Flows
 * up"): created on the business account once, its JSON uploaded (Meta answers with any validation
 * errors), and its data endpoint set to this environment's. Nothing of the token is ever printed.
 */

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Our Flows and their data endpoints (`/api/flows/<kind>`). */
export const flowKinds = ['booking', 'reschedule'] as const;
export type FlowKind = (typeof flowKinds)[number];

export const flowNames: Record<FlowKind, string> = {
  booking: 'Clinic Mx booking',
  reschedule: 'Clinic Mx reschedule',
};

const validation = z.object({
  validation_errors: z
    .array(
      z.object({
        error: z.string().optional(),
        message: z.string().optional(),
        line_start: z.number().optional(),
      }),
    )
    .optional(),
});

export function metaFlowClient(config: MetaConfig, send: Fetch = fetch) {
  const auth = { Authorization: `Bearer ${config.accessToken}` };
  const post = async (path: string, body: unknown, what: string) =>
    metaJson(
      await send(graph(config, path), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      what,
    );
  return {
    async create(name: string, endpointUri: string): Promise<string> {
      return z
        .object({ id: z.string() })
        .parse(
          await post(
            `${config.businessAccountId}/flows`,
            { name, categories: ['APPOINTMENT_BOOKING'], endpoint_uri: endpointUri },
            `Creating ${name}`,
          ),
        ).id;
    },
    /** Uploads the Flow's JSON; Meta's validation errors, empty when it took it. */
    async upload(flowId: string, json: string): Promise<string[]> {
      const form = new FormData();
      form.append('file', new Blob([json], { type: 'application/json' }), 'flow.json');
      form.append('name', 'flow.json');
      form.append('asset_type', 'FLOW_JSON');
      const answer = validation.parse(
        await metaJson(
          await send(graph(config, `${flowId}/assets`), {
            method: 'POST',
            headers: auth,
            body: form,
          }),
          'Uploading the Flow JSON',
        ),
      );
      return (answer.validation_errors ?? []).map((error) =>
        [
          error.line_start === undefined ? undefined : `line ${String(error.line_start)}`,
          error.error,
          error.message,
        ]
          .filter(Boolean)
          .join(': '),
      );
    },
    async setEndpoint(flowId: string, endpointUri: string): Promise<void> {
      await post(flowId, { endpoint_uri: endpointUri }, 'Setting the Flow endpoint');
    },
  };
}

export type MetaFlowClient = ReturnType<typeof metaFlowClient>;

/**
 * Creates the Flow when no id is given, uploads its JSON and points it at this environment's
 * endpoint. Its id, and Meta's validation errors.
 */
export async function setUpFlow(
  meta: MetaFlowClient,
  options: { kind: FlowKind; origin: string; json: string; flowId?: string },
): Promise<{ flowId: string; created: boolean; errors: string[] }> {
  const endpoint = `${options.origin.replace(/\/$/, '')}/api/flows/${options.kind}`;
  if (!/^https:\/\//.test(endpoint)) throw new MetaTemplateError('The origin must be https.');
  const flowId = options.flowId ?? (await meta.create(flowNames[options.kind], endpoint));
  const errors = await meta.upload(flowId, options.json);
  if (options.flowId) await meta.setEndpoint(flowId, endpoint);
  return { flowId, created: !options.flowId, errors };
}
