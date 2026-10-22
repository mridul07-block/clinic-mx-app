import { addDays, formatIstDate, istDate } from '@clinic-mx/schemas';
import { expect, test, type Page } from '@playwright/test';
import { removeRostersAndLeave } from './rosters';
import { signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SET-04 done when: managers set rosters; physios request their own leave. Decisions (user, 22
// October 2026): a weekly pattern per person per centre from a date; leave is requested and a
// manager decides, with a reason for a decline. Each test makes its own Centre Manager and physio
// at HSR Layout and removes their rosters and leave afterwards.

const today = istDate(new Date());

test('a manager sets a physio’s hours and decides their leave requests', async ({
  page,
  browser,
}) => {
  const manager = await temporaryWithCode('centre_manager', ['HSR Layout']);
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  const physioContext = await browser.newContext();
  const physioPage = await physioContext.newPage();
  try {
    // The manager sets Monday hours from today; a time off the 15 minute grid is refused.
    await signInWithCode(page, manager.email, manager.secret);
    await page.getByRole('link', { name: 'Team' }).click();
    await page.getByTestId('team-member').filter({ hasText: physio.name }).click();
    await expect(page.getByRole('heading', { name: physio.name })).toBeVisible();
    await expect(page.getByText('No working hours yet.')).toBeVisible();
    await page.getByLabel('Monday').fill('09:10-13:00');
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByText('Use steps of 15 minutes, for example 45.')).toBeVisible();
    await page.getByLabel('Monday').fill('09:00-13:00, 14:00-18:00');
    await page.getByLabel('Wednesday').fill('10:00-16:00');
    await page.getByRole('button', { name: 'Save hours' }).click();
    await expect(page.getByRole('status')).toHaveText('Working hours saved.');
    const hours = page.getByTestId('roster');
    await expect(hours).toContainText('HSR Layout');
    await expect(hours).toContainText('09:00–13:00, 14:00–18:00');
    await expect(hours).toContainText('10:00–16:00');

    // The physio requests part of tomorrow and the whole day after.
    const tomorrow = addDays(today, 1);
    const later = addDays(today, 2);
    await signInWithCode(physioPage, physio.email, physio.secret);
    await physioPage.getByRole('link', { name: 'My leave' }).click();
    await physioPage.getByLabel('Part of a day').check();
    await physioPage.getByLabel('Day', { exact: true }).fill(tomorrow);
    await physioPage.getByLabel('From', { exact: true }).fill('14:00');
    await physioPage.getByLabel('To', { exact: true }).fill('16:00');
    await physioPage.getByRole('button', { name: 'Request leave' }).click();
    await expect(physioPage.getByRole('status')).toContainText('Leave requested.');
    await physioPage.getByLabel('First day').fill(later);
    await physioPage.getByLabel('Last day').fill(later);
    await physioPage.getByRole('button', { name: 'Request leave' }).click();
    await expect(physioPage.getByRole('status')).toContainText('Leave requested.');
    await expect(
      physioPage.getByTestId('leave').filter({ hasText: 'Waiting for a decision' }),
    ).toHaveCount(2);

    // The manager declines the part day with a reason and approves the whole day.
    const partDay = `${formatIstDate(tomorrow)}, 14:00–16:00`;
    const wholeDay = formatIstDate(later);
    await page.goto('/app/team');
    const request = (when: string) =>
      page.getByTestId('leave-request').filter({ hasText: physio.name }).filter({ hasText: when });
    await request(partDay).getByRole('button', { name: 'Decline' }).click();
    await request(partDay).getByLabel('Why it is declined').fill('Two physios already away');
    await request(partDay).getByRole('button', { name: 'Decline leave' }).click();
    await expect(page.getByRole('status')).toContainText('Leave declined.');
    await request(wholeDay).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status')).toHaveText('Leave approved.');
    await expect(page.getByTestId('leave-request').filter({ hasText: physio.name })).toHaveCount(0);

    // The physio sees both decisions.
    await physioPage.reload();
    const entry = (when: string) => physioPage.getByTestId('leave').filter({ hasText: when });
    await expect(entry(partDay)).toContainText('Declined');
    await expect(entry(partDay)).toContainText('Reason: Two physios already away');
    await expect(entry(wholeDay)).toContainText('Approved');
    await expect(entry(wholeDay).getByRole('button', { name: 'Cancel leave' })).toHaveCount(0);
  } finally {
    await physioContext.close();
    await removeRostersAndLeave([physio.id, manager.id]);
  }
});

async function refused(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/app\/not-allowed/);
}

test('the front desk has neither Team nor My leave', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My leave' })).toHaveCount(0);
  await refused(page, '/app/team');
  await refused(page, '/app/leave');
});
