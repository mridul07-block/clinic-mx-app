import { parseArgs } from 'node:util';
import { appDb } from '../lib/db';
import { serverEnv } from '../lib/env';
import {
  MetaTemplateError,
  metaTemplateClient,
  samplePdf,
  submitTemplates,
  syncTemplates,
} from '../modules/messaging/meta-templates';

// The WhatsApp templates (WA-06): `pnpm whatsapp:templates <submit|sync>`. `submit --origin <url>`
// creates on Meta each registry version not there yet (link buttons lead to <url>/p/...), then
// records Meta's verdict; `sync` records it again. Uses the environment's WhatsApp token, business
// account and DATABASE_URL; prints template names and statuses only, never the token
// (docs/runbooks/whatsapp-templates.md).
const usage = `Usage:
  pnpm whatsapp:templates submit --origin https://<this environment's address>
  pnpm whatsapp:templates sync`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { origin: { type: 'string' } },
  });
  const [command] = positionals;
  const env = serverEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    throw new MetaTemplateError(
      'WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID are needed.',
    );
  }
  const meta = metaTemplateClient({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
  });
  if (command === 'sync') {
    console.log(`Recorded ${String(await syncTemplates(appDb(), meta))} template versions.`);
    return;
  }
  if (command !== 'submit' || !values.origin || !/^https:\/\/[^/]+\/?$/.test(values.origin)) {
    throw new MetaTemplateError(usage);
  }
  const results = await submitTemplates(appDb(), meta, { origin: values.origin, samplePdf });
  for (const result of results) {
    console.log(`${result.key} v${String(result.version)}: ${result.outcome}, ${result.status}`);
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof MetaTemplateError ? error.message : error);
  process.exit(1);
}
