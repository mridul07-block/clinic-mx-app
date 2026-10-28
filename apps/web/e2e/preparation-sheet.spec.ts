import { expect, test, type Page } from '@playwright/test';
import { aiSheetOff, aiSheetOn } from './ai-gate';
import { removeCalendarRows, startedAppointment } from './calendar';
import { otherBrowser, removePipelineRows, submitBackForm } from './intake';
import { liveVersion } from './knowledge-base';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testLink } from './patient-links';
import { testPatient } from './patients';
import { dispositionsOf, episodeOfVisit, seedReadySheet, sheetOf } from './preparation-sheet';
import { exclusively, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// AI-03 done when: unknown IDs dropped (unit tests); knowledge base text shown word for word; Keep
// and Dismiss stored; ready within 15 s. No OpenRouter key exists: a ranked sheet is seeded as the
// system stores one, and the real pipeline makes its sheet unavailable (not configured) within
// 15 seconds of the submit. The AI gate is shared by every test, so these hold its lock, switch it
// on and leave it off.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

function noSupabase(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co')) requests.push(request.url());
  });
  return requests;
}

async function consultationVisit() {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 5, {
    minutes: 5,
    values: { appointmentTypeId: await consultationTypeId() },
  });
  visits.push(visit.id);
  return { physio, patient, visit };
}

test('the visit’s consultant reads the sheet word for word and keeps or dismisses', async ({
  page,
  browser,
}) => {
  const supabaseRequests = noSupabase(page);
  const { physio, patient, visit } = await consultationVisit();
  await checkedIn(visit.id, (await temporaryDesk()).id);
  await submittedWithAlert(visit.id, patient.id);
  const other = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  physios.push(other.id);
  await exclusively('e2e ai preparation sheet', async () => {
    const version = await liveVersion();
    await aiSheetOn(version);
    try {
      const episodeId = await episodeOfVisit(visit.id);
      const seeded = await seedReadySheet(episodeId, version);

      await signInWithCode(page, physio.email, physio.secret);
      const row = page.getByTestId('my-patient').filter({ hasText: patient.name });
      await row.getByTestId('preparation-sheet-ready').click();
      await expect(
        page.getByRole('heading', { name: 'Preparation sheet', level: 1 }),
      ).toBeVisible();

      const cards = page.getByTestId('suggestion-card');
      await expect(cards).toHaveCount(5);
      await expect(
        page.getByTestId('sheet-likely').locator(':scope > ol > [data-testid="suggestion-card"]'),
      ).toHaveCount(3);
      for (const [index, seededRow] of seeded.suggestions.entries()) {
        const card = cards.nth(index);
        if (index === 3) await page.getByTestId('sheet-also-consider').locator('summary').click();
        await expect(card.getByTestId('suggestion-name')).toHaveText(seededRow.name);
        expect(await card.getByTestId('suggestion-question').textContent()).toBe(
          seededRow.discriminatingQuestion,
        );
        if (seededRow.testsImaging) {
          expect(await card.getByTestId('suggestion-tests').textContent()).toBe(
            seededRow.testsImaging,
          );
        }
        await expect(card.getByText('Assistant suggestion')).toBeVisible();
      }
      const ruleOut = page.getByTestId('must-rule-out');
      await expect(ruleOut).toHaveCount(1);
      await expect(ruleOut.locator('summary')).toHaveText(seeded.mustRuleOut.name);
      await ruleOut.locator('summary').click();
      expect(await ruleOut.getByTestId('must-rule-out-question').textContent()).toBe(
        seeded.mustRuleOut.discriminatingQuestion,
      );
      await expect(ruleOut.getByRole('button')).toHaveCount(0);
      // AI-05: the similar confirmed cases, as sent: structured fields, no names, dates or IDs.
      const similar = page.getByTestId('similar-case');
      await expect(similar).toHaveCount(3);
      await expect(similar.nth(0)).toContainText(seeded.suggestions[0]?.name ?? '');
      await expect(similar.nth(0)).toContainText('Confirmed diagnosis');
      await expect(similar.nth(0)).toContainText('Age 28 · Female · Knee · 4 weeks');
      await expect(page.getByTestId('sheet-similar')).not.toContainText(/Test Patient|HSR-|2026/);
      await page.screenshot({
        path: test.info().outputPath('preparation-sheet.png'),
        fullPage: true,
      });

      await cards.nth(0).getByRole('button', { name: 'Keep' }).click();
      await expect(cards.nth(0).getByRole('button', { name: 'Kept' })).toBeVisible();
      await cards.nth(1).getByRole('button', { name: 'Dismiss' }).click();
      await expect(cards.nth(1).getByRole('button', { name: 'Dismissed' })).toBeVisible();
      await page.reload();
      await expect(cards.nth(0).getByRole('button', { name: 'Kept' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect((await dispositionsOf(episodeId)).map((d) => d.disposition)).toEqual([
        'kept',
        'dismissed',
        null,
        null,
        null,
      ]);

      // A physio without the Consultant tick sees no sheet.
      const otherPage = await (await browser.newContext()).newPage();
      await signInWithCode(otherPage, other.email, other.secret);
      await otherPage.goto(`/app/episodes/${episodeId}/preparation-sheet`);
      await expect(otherPage).toHaveURL(/\/app\/not-allowed/);
      await otherPage.context().close();

      // With the AI gate off, the sheet and its marker are gone.
      await aiSheetOff();
      await page.goto('/app/my-patients');
      await expect(row).toBeVisible();
      await expect(row.getByTestId('preparation-sheet-ready')).toHaveCount(0);
      const gone = await page.goto(`/app/episodes/${episodeId}/preparation-sheet`);
      expect(gone?.status()).toBe(404);
    } finally {
      await aiSheetOff();
    }
  });
  expect(supabaseRequests).toEqual([]);
});

test('the submit makes the sheet within 15 seconds, unavailable without a model', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 3, {
    minutes: 5,
    values: {
      appointmentTypeId: await consultationTypeId(),
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: physio.id,
    },
  });
  visits.push(visit.id);
  const link = await testLink({
    purpose: 'health_form',
    patientId: patient.id,
    appointmentId: visit.id,
  });
  await exclusively('e2e ai preparation sheet', async () => {
    await aiSheetOn(await liveVersion());
    try {
      const patientPage = await otherBrowser(browser);
      await submitBackForm(patientPage, link.path, [], ['None of these']);
      await patientPage.context().close();
      const episodeId = await episodeOfVisit(visit.id);
      await expect
        .poll(async () => (await sheetOf(episodeId)).sheet?.status, { timeout: 15_000 })
        .toBe('unavailable');
      const { sheet, submittedAt } = await sheetOf(episodeId);
      expect(sheet).toMatchObject({ reason: 'not_configured', runStatus: 'not_configured' });
      expect((sheet?.readyAt?.getTime() ?? Infinity) - (submittedAt?.getTime() ?? 0)).toBeLessThan(
        15_000,
      );

      await signInWithCode(page, physio.email, physio.secret);
      const row = page.getByTestId('my-patient').filter({ hasText: patient.name });
      await row.getByTestId('preparation-sheet-ready').click();
      await expect(page.getByTestId('sheet-unavailable')).toHaveText(
        'Suggestions unavailable right now. Continue the consultation as usual.',
      );
      const flagged = (sheet?.shortlist as { items: { mustRuleOut: boolean }[] }).items.filter(
        (item) => item.mustRuleOut,
      );
      await expect(page.getByTestId('must-rule-out')).toHaveCount(flagged.length);
      expect(flagged.length).toBeGreaterThan(0);
      await expect(page.getByTestId('sheet-told')).toContainText('Back');
      await expect(page.getByTestId('suggestion-card')).toHaveCount(0);
      // AI-05: the similar cases chosen are kept with the sheet, and shown (none when too few).
      expect(Array.isArray(sheet?.similar)).toBe(true);
      await expect(page.getByTestId('sheet-similar')).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath('preparation-sheet-unavailable.png'),
        fullPage: true,
      });
    } finally {
      await aiSheetOff();
    }
  });
});
