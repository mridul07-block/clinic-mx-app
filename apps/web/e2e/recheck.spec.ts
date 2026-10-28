import { expect, test } from '@playwright/test';
import { aiSheetOff, aiSheetOn } from './ai-gate';
import { removeCalendarRows, startedAppointment } from './calendar';
import { draftSections, submittedAnswers } from './consultations';
import { removePipelineRows } from './intake';
import { liveVersion } from './knowledge-base';
import { checkedIn, consultationTypeId, submittedWithAlert } from './my-patients';
import { testPatient } from './patients';
import {
  dispositionsOf,
  episodeOfVisit,
  recheckOf,
  recheckRunning,
  seedReadySheet,
  seedRecheck,
} from './preparation-sheet';
import { exclusively, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// AI-04 done when: reranks with examination results only when tapped. No OpenRouter key exists:
// the tap runs the real path, which records an unavailable recheck (not configured) and never
// blocks; a ready recheck is then seeded as the system stores one. The AI gate is shared by every
// test, so this holds its lock, switches it on and leaves it off.

const physios: string[] = [];
const visits: string[] = [];
test.afterEach(async () => {
  await removePipelineRows(visits.splice(0));
  if (physios.length) await removeCalendarRows(physios.splice(0));
});

test('the consultant rechecks with findings only when tapped, and keeps the result on the sheet', async ({
  page,
  browser,
}) => {
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout'], { consultant: true });
  physios.push(physio.id);
  const patient = await testPatient();
  const visit = await startedAppointment(physio.id, patient.id, 5, {
    minutes: 5,
    values: { appointmentTypeId: await consultationTypeId() },
  });
  visits.push(visit.id);
  await checkedIn(visit.id, (await temporaryDesk()).id);
  await submittedWithAlert(visit.id, patient.id);
  await submittedAnswers(visit.id, patient.id, { region: 'knee', sex: 'female' });
  const colleague = await temporaryWithCode('physiotherapist', ['HSR Layout'], {
    consultant: true,
  });
  physios.push(colleague.id);

  await exclusively('e2e ai preparation sheet', async () => {
    const version = await liveVersion();
    await aiSheetOn(version);
    try {
      const episodeId = await episodeOfVisit(visit.id);
      await seedReadySheet(episodeId, version);
      await signInWithCode(page, physio.email, physio.secret);
      await page.getByRole('button', { name: `Start consultation for ${patient.name}` }).click();
      await expect(page.locator('#consultation-step')).toHaveText('Subjective');
      const path = new URL(page.url()).pathname;

      // Nothing to send before a test or a measure is recorded; nothing runs untapped.
      await page.goto(`${path}?section=assessment`);
      const panel = page.getByTestId('recheck-panel');
      await expect(panel).toContainText('Record a special test result or a measure first.');
      await expect(panel.getByRole('button', { name: 'Recheck with findings' })).toBeDisabled();

      await draftSections(visit.id, {
        objective: {
          notes: 'Free text never sent',
          region: 'knee',
          side: 'right',
          measures: { 'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 } },
          tests: [
            {
              key: 'knee.lachman_20_30_degrees_flexion',
              result: 'positive',
              interpretation: 'Free text never sent',
            },
          ],
        },
      });
      await page.reload();
      await expect(panel.getByTestId('recheck-findings').locator('summary')).toHaveText(
        'Findings to send (2)',
      );
      expect(await recheckOf(episodeId)).toMatchObject({ status: null });

      await panel.getByRole('button', { name: 'Recheck with findings' }).click();
      await expect(panel.getByTestId('recheck-unavailable')).toHaveText(
        'Suggestions unavailable right now. Continue the consultation as usual.',
      );
      const stored = await recheckOf(episodeId);
      expect(stored).toMatchObject({
        status: 'unavailable',
        reason: 'not_configured',
        runKind: 'recheck_with_findings',
        runStatus: 'not_configured',
      });
      const findings = stored?.findings as string[];
      expect(findings).toHaveLength(2);
      expect(JSON.stringify(findings)).not.toContain('Free text never sent');
      expect(findings[0]).toMatch(/^Lachman.*: Positive$/);

      // The same panel shows a ready recheck, and the sheet keeps it beside the first ranking.
      // A recheck still running holds the button; one whose run stopped lets the consultant tap again.
      const button = panel.getByRole('button', { name: /Recheck/ });
      await recheckRunning(episodeId, 0);
      await page.reload();
      await expect(button).toHaveText('Rechecking…');
      await expect(button).toBeDisabled();
      await recheckRunning(episodeId, 10);
      await page.reload();
      await expect(button).toHaveText('Recheck with findings');
      await expect(button).toBeEnabled();

      const rechecked = await seedRecheck(episodeId, version);
      await page.reload();
      await expect(panel.getByTestId('recheck-suggestion')).toHaveCount(rechecked.length);
      await expect(panel.getByText(/Your findings changed/)).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('recheck.png'), fullPage: true });

      await panel.getByRole('link', { name: 'Keep or dismiss on the preparation sheet' }).click();
      const section = page.getByTestId('sheet-recheck');
      await expect(section.getByRole('heading', { name: 'Rechecked with findings' })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Likely diagnoses before examination' }),
      ).toBeVisible();
      const cards = section.getByTestId('suggestion-card');
      await expect(cards).toHaveCount(rechecked.length);
      await cards.nth(0).getByRole('button', { name: 'Keep' }).click();
      await expect(cards.nth(0).getByRole('button', { name: 'Kept' })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('recheck-sheet.png'), fullPage: true });
      expect(
        (await dispositionsOf(episodeId)).filter((d) => d.disposition === 'kept'),
      ).toHaveLength(1);

      // New findings since: the consultation says so.
      await draftSections(visit.id, {
        objective: {
          region: 'knee',
          side: 'right',
          measures: {},
          tests: [{ key: 'knee.lachman_20_30_degrees_flexion', result: 'negative' }],
        },
      });
      await page.goto(`${path}?section=assessment`);
      await expect(panel.getByText(/Your findings changed since this recheck\./)).toBeVisible();

      // Another consultant at the centre cannot open an unsigned consultation not theirs (the
      // service unit tests hold loadRecheck to the consultation's own consultant).
      const otherPage = await (await browser.newContext()).newPage();
      await signInWithCode(otherPage, colleague.email, colleague.secret);
      await otherPage.goto(`${path}?section=assessment`);
      await expect(otherPage.getByTestId('recheck-panel')).toHaveCount(0);
      await otherPage.context().close();

      // With the AI gate off, the panel is gone.
      await aiSheetOff();
      await page.reload();
      await expect(page.locator('#consultation-step')).toHaveText('Assessment');
      await expect(panel).toHaveCount(0);
    } finally {
      await aiSheetOff();
    }
  });
});
