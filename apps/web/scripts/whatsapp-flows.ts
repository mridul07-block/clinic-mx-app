import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { serverEnv } from '../lib/env';
import {
  flowKinds,
  metaFlowClient,
  setUpFlow,
  type FlowKind,
} from '../modules/messaging/meta-flows';
import { MetaTemplateError } from '../modules/messaging/meta-templates';

// The WhatsApp Flows (WA-04, WA-05): `pnpm whatsapp:flows <booking|reschedule> --origin <url>
// [--id <flow id>]` creates the Flow on the business account (or, with --id, updates that one),
// uploads its JSON from modules/messaging/flows and points it at <url>/api/flows/<kind>. Prints the
// Flow's id and Meta's validation errors, never the token (docs/runbooks/whatsapp.md).
const usage = `Usage:
  pnpm whatsapp:flows <booking|reschedule> --origin https://<this environment's address> [--id <flow id>]`;

const isKind = (value: string | undefined): value is FlowKind =>
  (flowKinds as readonly (string | undefined)[]).includes(value);

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { origin: { type: 'string' }, id: { type: 'string' } },
  });
  const [kind] = positionals;
  const env = serverEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    throw new MetaTemplateError(
      'WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID are needed.',
    );
  }
  if (
    !isKind(kind) ||
    !values.origin ||
    !/^https:\/\/[^/]+\/?$/.test(values.origin) ||
    (values.id !== undefined && !/^\d+$/.test(values.id))
  ) {
    throw new MetaTemplateError(usage);
  }
  const meta = metaFlowClient({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- one of the two Flow files in the repo, `kind` checked against `flowKinds` above
  const json = readFileSync(
    new URL(`../modules/messaging/flows/${kind}-flow.json`, import.meta.url),
    'utf8',
  );
  const result = await setUpFlow(meta, { kind, origin: values.origin, json, flowId: values.id });
  console.log(`${kind}: Flow ${result.flowId} ${result.created ? 'created' : 'updated'}`);
  if (result.errors.length === 0) console.log('Meta took the JSON without validation errors.');
  for (const error of result.errors) console.log(`Validation: ${error}`);
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof MetaTemplateError ? error.message : error);
  process.exit(1);
}
