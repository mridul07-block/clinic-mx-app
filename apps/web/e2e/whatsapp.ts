import { createHmac } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';

// The WhatsApp webhook for end to end tests (WA-02): test values playwright.config.ts gives the
// server, never the Meta app's own. With them a test signs bodies as Meta would.
export const TEST_WHATSAPP_APP_SECRET = 'e2e-only-whatsapp-app-secret-never-on-a-deployment';
export const TEST_WHATSAPP_VERIFY_TOKEN = 'e2e-only-whatsapp-verify-token';

/** Posts a body to the webhook, signed with the test app secret unless `signed` is false. */
export function postWebhook(
  request: APIRequestContext,
  body: unknown,
  { signed = true }: { signed?: boolean } = {},
): Promise<APIResponse> {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', TEST_WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  return request.post('/api/whatsapp/webhook', {
    data: raw,
    headers: {
      'content-type': 'application/json',
      ...(signed ? { 'x-hub-signature-256': signature } : {}),
    },
  });
}

/** Meta's envelope around one `messages` change. */
export function webhookBody(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '1103346035769121', changes: [{ field: 'messages', value }] }],
  };
}
