import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validVerifyToken, validWebhookSignature, webhookSignature } from './webhook-signature';

// WA-02: only Meta, holding the app secret, can sign a body we accept.
const secret = 'a'.repeat(32);
const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');

describe('the webhook signature', () => {
  it('is Meta’s sha256 HMAC of the exact bytes, as hex', () => {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    expect(webhookSignature(body, secret)).toBe(`sha256=${expected}`);
    expect(validWebhookSignature(body, `sha256=${expected}`, secret)).toBe(true);
    expect(validWebhookSignature(body, `sha256=${expected.toUpperCase()}`, secret)).toBe(true);
  });

  it('refuses another body, another secret, another scheme or none', () => {
    const signed = webhookSignature(body, secret);
    const changed = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[1]}');
    expect(validWebhookSignature(changed, signed, secret)).toBe(false);
    expect(validWebhookSignature(body, signed, 'b'.repeat(32))).toBe(false);
    expect(validWebhookSignature(body, signed.replace('sha256=', 'sha1='), secret)).toBe(false);
    expect(validWebhookSignature(body, null, secret)).toBe(false);
    expect(validWebhookSignature(body, '', secret)).toBe(false);
  });
});

describe('the verify token', () => {
  it('matches only ours, and never when ours is not set', () => {
    expect(validVerifyToken('t'.repeat(20), 't'.repeat(20))).toBe(true);
    expect(validVerifyToken('t'.repeat(19), 't'.repeat(20))).toBe(false);
    expect(validVerifyToken(null, 't'.repeat(20))).toBe(false);
    expect(validVerifyToken('', undefined)).toBe(false);
  });
});
