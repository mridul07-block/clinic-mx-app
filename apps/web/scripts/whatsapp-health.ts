import { serverEnv } from '../lib/env';

// Whether WhatsApp can send on this environment (docs/runbooks/whatsapp.md, "Health"): `pnpm
// whatsapp:health` asks Meta for the `health_status` of the phone number and of each Flow, and
// prints, for each part Meta names (the app, the business, the WhatsApp account, the number, the
// Flow), whether it may send and Meta's error codes. A Flow is refused (139000) while the business
// behind the number is not verified. Prints ids, states and codes only, never the token.

interface HealthEntity {
  entity_type?: string;
  id?: string;
  can_send_message?: string;
  errors?: { error_code?: number; error_description?: string }[];
}

interface Health {
  name?: string;
  status?: string;
  health_status?: { can_send_message?: string; entities?: HealthEntity[] };
  error?: { code?: number };
}

async function health(
  graphVersion: string,
  accessToken: string,
  id: string,
  fields: string,
): Promise<Health> {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${id}?fields=${fields}`,
    { headers: { authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
  );
  return (await response.json()) as Health;
}

function print(label: string, answer: Health): void {
  if (answer.error) {
    console.log(`${label}: Meta refused the question (code ${String(answer.error.code)})`);
    return;
  }
  const state = answer.health_status?.can_send_message ?? 'unknown';
  const extra = answer.status ? ` (${answer.status})` : '';
  console.log(`${label}${extra}: ${state}`);
  for (const entity of answer.health_status?.entities ?? []) {
    const codes = (entity.errors ?? []).map((error) => String(error.error_code));
    console.log(
      `  ${entity.entity_type ?? '?'} ${entity.id ?? ''}: ${entity.can_send_message ?? '?'}` +
        (codes.length > 0 ? ` [${codes.join(', ')}]` : ''),
    );
    for (const error of entity.errors ?? []) {
      console.log(`    ${String(error.error_code)}: ${error.error_description ?? ''}`);
    }
  }
}

async function main() {
  const env = serverEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    console.log('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are needed.');
    process.exit(1);
  }
  const ask = (id: string, fields: string) =>
    health(env.WHATSAPP_GRAPH_VERSION, env.WHATSAPP_ACCESS_TOKEN ?? '', id, fields);
  print('Phone number', await ask(env.WHATSAPP_PHONE_NUMBER_ID, 'health_status'));
  for (const [label, id] of [
    ['Booking form', env.WHATSAPP_BOOKING_FLOW_ID],
    ['Reschedule form', env.WHATSAPP_RESCHEDULE_FLOW_ID],
  ] as const) {
    if (!id) console.log(`${label}: not set up on this environment`);
    else print(label, await ask(id, 'name,status,health_status'));
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.log(error instanceof Error ? error.message : 'Could not ask Meta.');
  process.exit(1);
}
