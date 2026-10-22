import { expect, test, type Page } from '@playwright/test';
import { restoreCentres, snapshotCentres } from './centres';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporarySuperAdmin } from './staff';

// SET-01 done when: address, map link, phone and chart colour per centre. Decisions (user, 22
// October 2026): the Super Admin adds, edits and deactivates centres; colours come from the
// design system's three centre colours, one per active centre. Tests that change centres take
// turns (the `e2e centres` lock) and put every centre back afterwards.

/** Runs `work` alone among centre tests, restoring every centre afterwards. */
async function changingCentres(work: () => Promise<void>) {
  await exclusively('e2e centres', async () => {
    const snapshot = await snapshotCentres();
    try {
      await work();
    } finally {
      await restoreCentres(snapshot);
    }
  });
}

async function signInAdmin(page: Page) {
  const admin = await temporarySuperAdmin({ support: false });
  await signInWithCode(page, admin.email, admin.secret);
}

const centreCard = (page: Page, name: string) =>
  page.getByTestId('centre').filter({ has: page.getByText(name, { exact: true }) });

test('the Super Admin keeps each centre’s address, phone, map link and colour', async ({
  page,
}) => {
  await signInAdmin(page);
  await changingCentres(async () => {
    await page.goto('/app');
    await page.getByRole('link', { name: 'Centres' }).click();
    await expect(page.getByRole('heading', { name: 'Centres' })).toBeVisible();
    // Three active; centres earlier tests added stay listed, inactive (never deleted).
    await expect(
      page.getByTestId('centre').filter({ has: page.getByText('Active', { exact: true }) }),
    ).toHaveCount(3);
    await expect(centreCard(page, 'HSR Layout')).toContainText('Blue');
    await expect(centreCard(page, 'Koramangala')).toContainText('Violet');
    await expect(centreCard(page, 'Whitefield')).toContainText('Teal');
    // SCH-01: each centre's code, at the start of its OP numbers.
    await expect(centreCard(page, 'HSR Layout')).toContainText('HSR');
    await expect(centreCard(page, 'Whitefield')).toContainText('WFD');

    await centreCard(page, 'HSR Layout').click();
    await expect(page.getByRole('heading', { name: 'HSR Layout' })).toBeVisible();
    // The code is shown, never offered for editing.
    await expect(page.getByTestId('centre-code')).toContainText('HSR');
    await expect(page.getByLabel('Code')).toHaveCount(0);
    // Bad details are refused, field by field.
    await page.getByLabel('Phone').fill('12345');
    await page.getByLabel('Map link').fill('https://example.com/hsr');
    await page.getByRole('button', { name: 'Save centre' }).click();
    await expect(page.getByText('Enter a 10 digit Indian phone number')).toBeVisible();
    await expect(page.getByText('Paste the Google Maps link to the centre')).toBeVisible();

    await page.getByLabel('Phone').fill('080 4123 4567');
    await page.getByLabel('Map link').fill('https://maps.app.goo.gl/TestOnly123');
    await page.getByRole('button', { name: 'Save centre' }).click();
    await expect(page.getByRole('status')).toHaveText('Centre saved.');
    await expect(page.getByLabel('Phone')).toHaveValue('+91 80 4123 4567');

    await page.getByRole('link', { name: 'Centres' }).click();
    await expect(centreCard(page, 'HSR Layout')).toContainText('+91 80 4123 4567 · Map link set');
  });
});

test('with every colour in use, a new centre must wait for a new colour', async ({ page }) => {
  await signInAdmin(page);
  await changingCentres(async () => {
    await page.goto('/app/centres');
    await expect(page.getByTestId('no-free-colour')).toHaveText(
      'All centre colours are in use. A new colour must be added to the design system before another centre can be active.',
    );
    await expect(page.getByRole('link', { name: 'Add a centre' })).toHaveCount(0);
    // Going there anyway: the page says so, with no form to fill in vain.
    await page.goto('/app/centres/new');
    await expect(page.getByRole('status')).toContainText('All centre colours are in use.');
    await expect(page.getByRole('button', { name: 'Add centre' })).toHaveCount(0);
  });
});

test('deactivating a centre frees its colour; reactivating needs it free again', async ({
  page,
}) => {
  await signInAdmin(page);
  await changingCentres(async () => {
    const name = `Test centre ${crypto.randomUUID().slice(0, 8)}`;
    await page.goto('/app/centres');
    await centreCard(page, 'Whitefield').click();
    await page.getByRole('button', { name: 'Deactivate centre' }).click();
    await expect(page.getByText('Deactivate Whitefield?')).toBeVisible();
    await page.getByRole('button', { name: 'Deactivate centre' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Centre deactivated. Its staff, tablets and history are kept.',
    );

    // Teal is free now: a new centre takes it.
    await page.goto('/app/centres');
    await page.getByRole('link', { name: 'Add a centre' }).click();
    // The colours in use say who has them and cannot be chosen.
    await expect(page.getByText('Blue (used by HSR Layout)')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Blue/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Violet/ })).toBeDisabled();
    await page.getByLabel('Name').fill(name);
    // Codes never repeat (SCH-01): four random letters, typed in lower case.
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
      String.fromCharCode(97 + (byte % 26)),
    ).join('');
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('Address').fill('100 Feet Rd, Indiranagar, Bengaluru 560038');
    await page.getByLabel('Phone').fill('98450 12345');
    await page.getByLabel('Map link').fill('https://maps.app.goo.gl/TestOnly123');
    await expect(page.getByRole('radio', { name: 'Teal' })).toBeChecked();
    await page.getByRole('button', { name: 'Add centre' }).click();
    await expect(page.getByRole('status')).toHaveText('Centre added.');
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByTestId('centre-code')).toContainText(code.toUpperCase());

    // Whitefield cannot come back while teal is taken.
    await page.goto('/app/centres');
    await centreCard(page, 'Whitefield').click();
    await page.getByRole('button', { name: 'Reactivate centre' }).click();
    await expect(
      page.getByText(
        `Teal is used by ${name}. Choose another colour for Whitefield before reactivating it.`,
      ),
    ).toBeVisible();

    // Once the test centre stops, it can.
    await page.goto('/app/centres');
    await centreCard(page, name).click();
    await page.getByRole('button', { name: 'Deactivate centre' }).click();
    await page.getByRole('button', { name: 'Deactivate centre' }).click();
    await expect(page.getByRole('status')).toContainText('Centre deactivated.');
    await page.goto('/app/centres');
    await centreCard(page, 'Whitefield').click();
    await page.getByRole('button', { name: 'Reactivate centre' }).click();
    await expect(page.getByRole('status')).toHaveText('Centre reactivated.');
  });
});

test('only the Super Admin manages centres', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await expect(page.getByRole('link', { name: 'Centres' })).toHaveCount(0);
  await page.goto('/app/centres');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
