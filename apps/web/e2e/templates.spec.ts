import {
  createDb,
  job,
  systemActor,
  whatsappEvent,
  whatsappTemplate,
  withActor,
} from '@clinic-mx/db';
import { expect, test, type Page } from '@playwright/test';
import { eq, sql } from 'drizzle-orm';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';
import { postWebhook } from './whatsapp';

// SET-11 done when: keys, variables and versions are viewable by the Super Admin. The registry is
// in code (packages/schemas/src/message-templates.ts). WA-06 done when: every template in the TAD
// list is approved on the test number; the page shows each one's text and Meta's verdict on this
// environment, which Meta's signed template webhook moves on. The version a test records, and the
// webhook bodies it posts, are removed afterwards.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1 });
  return database.db;
};
const metaIds: string[] = [];
test.afterEach(async () => {
  const ids = metaIds.splice(0);
  if (ids.length === 0) return;
  await withActor(db(), systemActor('tests'), async (tx) => {
    for (const metaId of ids) {
      const events = await tx
        .select({ id: whatsappEvent.id })
        .from(whatsappEvent)
        .where(sql`${whatsappEvent.payload}::text like ${`%${metaId}%`}`);
      for (const event of events) {
        await tx.delete(job).where(eq(job.idempotencyKey, `whatsapp.event:${event.id}`));
        await tx.delete(whatsappEvent).where(eq(whatsappEvent.id, event.id));
      }
      await tx.delete(whatsappTemplate).where(eq(whatsappTemplate.metaId, metaId));
    }
  });
});
test.afterAll(async () => {
  await database?.close();
});

const card = (page: Page, key: string) =>
  page
    .getByTestId('message-template')
    .filter({ has: page.getByTestId('template-key').getByText(key, { exact: true }) });

test('the Super Admin views every template with its key, variables and version', async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) {
      supabaseRequests.push(request.url());
    }
  });
  const admin = await temporaryWithCode('super_admin', []);
  await signInWithCode(page, admin.email, admin.secret);
  // The Super Admin lands on the Overview (DSH-05); the templates are a home link.
  await page.goto('/app');
  await page.getByRole('main').getByRole('link', { name: 'WhatsApp templates' }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp templates', level: 1 })).toBeVisible();
  await expect(page.getByTestId('message-template')).toHaveCount(16);
  await expect(page.getByTestId('template-count')).toContainText('16 templates');

  const confirmation = card(page, 'booking_confirmation');
  await expect(confirmation.getByText('Booking confirmation', { exact: true })).toBeVisible();
  await expect(confirmation.getByText('Version 1')).toBeVisible();
  await expect(confirmation.getByTestId('template-body')).toHaveText(
    'Hi {{patient_name}}, your appointment is booked: {{date}} at {{time}}, Movementology {{clinic}}, with {{physio}}. Reply to this message if you need to change it.',
  );
  await expect(confirmation.getByTestId('template-variables')).toContainText(
    "patient_name: The patient's first name",
  );
  for (const name of ['date', 'time', 'clinic', 'physio']) {
    await expect(
      confirmation.getByTestId('template-variables').getByText(name, { exact: true }),
    ).toBeVisible();
  }

  const reminder = card(page, 'day_before_reminder');
  await expect(reminder).toContainText('Confirm (Quick reply), Reschedule (WhatsApp Flow)');
  await expect(reminder).not.toContainText('Not submitted yet');
  await expect(card(page, 'consultation_summary')).toContainText('Document (PDF)');
  expect(supabaseRequests).toEqual([]);
});

test('Meta’s verdict on a template shows, and its signed webhook moves it on', async ({
  page,
}, testInfo) => {
  // Each project its own template, as both may run at once on one database.
  const key = testInfo.project.name === 'phone' ? 'morning_reminder' : 'session_3_check';
  const metaId = String(9_000_000_000_000 + Math.floor(Math.random() * 1e12));
  metaIds.push(metaId);
  await withActor(db(), systemActor('whatsapp-templates'), (tx) =>
    tx.insert(whatsappTemplate).values({
      key,
      version: 1,
      language: 'en',
      metaName: `${key}_v1`,
      metaId,
      category: 'UTILITY',
      status: 'pending',
    }),
  );
  const admin = await temporaryWithCode('super_admin', []);
  await signInWithCode(page, admin.email, admin.secret);
  await page.goto('/app/templates');
  const template = card(page, key);
  await expect(template).toHaveAttribute('data-approval', 'pending');
  await expect(template.getByText('Waiting for Meta')).toBeVisible();
  await expect(card(page, 'no_show')).toHaveAttribute('data-approval', 'not_submitted');
  await expect(card(page, 'no_show').getByText('Not submitted', { exact: true })).toBeVisible();

  const update = (event: string, reason: string) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1103346035769121',
        changes: [
          {
            field: 'message_template_status_update',
            value: {
              event,
              message_template_id: Number(metaId),
              message_template_name: `${key}_v1`,
              message_template_language: 'en',
              reason,
            },
          },
        ],
      },
    ],
  });
  expect((await postWebhook(page.request, update('REJECTED', 'INVALID_FORMAT'))).status()).toBe(
    200,
  );
  await expect
    .poll(async () => {
      await page.reload();
      return template.getAttribute('data-approval');
    })
    .toBe('rejected');
  await expect(template.getByTestId('template-reason')).toHaveText('Meta: INVALID_FORMAT');

  expect((await postWebhook(page.request, update('APPROVED', 'NONE'))).status()).toBe(200);
  await expect
    .poll(async () => {
      await page.reload();
      return template.getAttribute('data-approval');
    })
    .toBe('approved');
  await expect(template.getByText('Approved by Meta')).toBeVisible();
  await expect(template.getByTestId('template-reason')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('templates-approval.png'), fullPage: true });
});

test('the front desk cannot open WhatsApp templates', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'WhatsApp templates' })).toHaveCount(0);
  await page.goto('/app/templates');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('a physiotherapist cannot open WhatsApp templates', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app/templates');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
