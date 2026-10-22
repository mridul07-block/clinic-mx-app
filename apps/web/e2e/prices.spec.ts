import { expect, test, type Page } from '@playwright/test';
import { restorePrices, snapshotPrices } from './prices';
import { exclusively, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';

// SET-02 done when: Finance and Super Admin edit; changes audited (the database tests check the
// audit rows). Centre Managers and the front desk read prices; physiotherapists see none. Tests
// that change prices take turns (the `e2e prices` lock) and put the price list back afterwards.

/** Runs `work` alone among price tests, restoring the price list afterwards. */
async function changingPrices(work: () => Promise<void>) {
  await exclusively('e2e prices', async () => {
    const snapshot = await snapshotPrices();
    try {
      await work();
    } finally {
      await restorePrices(snapshot);
    }
  });
}

async function signInFinance(page: Page) {
  const finance = await temporaryWithCode('finance');
  await signInWithCode(page, finance.email, finance.secret);
}

const row = (page: Page, testId: string, name: string) =>
  page.getByTestId(testId).filter({ has: page.getByText(name, { exact: true }) });

test('Finance changes a price, and the list shows the new one', async ({ page }) => {
  await signInFinance(page);
  await changingPrices(async () => {
    await page.goto('/app');
    await page.getByRole('link', { name: 'Prices' }).click();
    await expect(page.getByRole('heading', { name: 'Prices', exact: true })).toBeVisible();
    await expect(row(page, 'price-item', 'Consultation')).toContainText('₹750');
    await expect(row(page, 'price-item', 'Zero Gravity Treadmill')).toContainText('₹2,000');

    await row(page, 'price-item', 'Zero Gravity Treadmill').click();
    await expect(page.getByRole('heading', { name: 'Zero Gravity Treadmill' })).toBeVisible();
    await expect(page.getByLabel('Price')).toHaveValue('2,000');
    await page.getByLabel('Price').fill('two thousand');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByText('Enter an amount in rupees, for example 1,500.')).toBeVisible();

    await page.getByLabel('Price').fill('₹2,500');
    await page.getByRole('button', { name: 'Save price' }).click();
    await expect(page.getByRole('status')).toHaveText('Price saved.');
    await expect(page.getByLabel('Price')).toHaveValue('2,500');

    await page.getByRole('link', { name: 'Prices' }).click();
    await expect(row(page, 'price-item', 'Zero Gravity Treadmill')).toContainText('₹2,500');
  });
});

test('Finance adds a package type and preset discounts, and deactivates one', async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 6);
  const packageName = `E2E package ${suffix}`;
  const percentName = `E2E runners ${suffix}`;
  const flatName = `E2E doctors ${suffix}`;
  await signInFinance(page);
  await changingPrices(async () => {
    await page.goto('/app/prices');
    await page.getByRole('link', { name: 'Add a package type' }).click();
    await page.getByLabel('Name').fill(packageName);
    await page.getByLabel('Sessions').fill('10');
    await page.getByLabel('Package price').fill('9,000');
    await page.getByRole('button', { name: 'Add package type' }).click();
    await expect(page.getByText('Choose what the package covers.')).toBeVisible();
    await page.getByRole('checkbox', { name: /^Rehabilitation session/ }).check();
    await page.getByRole('checkbox', { name: /^PEMF/ }).check();
    await page.getByRole('button', { name: 'Add package type' }).click();
    await expect(page.getByRole('status')).toHaveText('Package type added.');
    await page.getByRole('link', { name: 'Prices' }).click();
    await expect(row(page, 'package-type', packageName)).toContainText('₹9,000');
    await expect(row(page, 'package-type', packageName)).toContainText(
      '10 sessions · PEMF, Rehabilitation session',
    );

    await page.getByRole('link', { name: 'Add a discount' }).click();
    await page.getByLabel('Name').fill(percentName);
    await page.getByLabel('Percent off', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Add discount' }).click();
    await expect(page.getByRole('status')).toHaveText('Discount added.');
    await page.getByRole('link', { name: 'Prices' }).click();
    await page.getByRole('link', { name: 'Add a discount' }).click();
    await page.getByLabel('Name').fill(flatName);
    await page.getByLabel('A flat amount off').check();
    await page.getByLabel('Amount off', { exact: true }).fill('500');
    await page.getByRole('button', { name: 'Add discount' }).click();
    await expect(page.getByRole('status')).toHaveText('Discount added.');
    await page.getByRole('link', { name: 'Prices' }).click();
    await expect(row(page, 'discount-preset', percentName)).toContainText('10% off');
    await expect(row(page, 'discount-preset', flatName)).toContainText('₹500 off');

    await row(page, 'discount-preset', percentName).click();
    await page.getByRole('button', { name: 'Deactivate discount' }).click();
    await expect(page.getByText(`Deactivate ${percentName}?`)).toBeVisible();
    await page.getByRole('button', { name: 'Deactivate discount' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Discount deactivated. Bills already made and its history are kept.',
    );
    await page.getByRole('link', { name: 'Prices' }).click();
    await expect(row(page, 'discount-preset', percentName)).toContainText('Inactive');
    await expect(row(page, 'discount-preset', flatName)).not.toContainText('Inactive');
  });
});

test('the front desk reads prices but cannot change them', async ({ page }) => {
  const desk = await temporaryDesk();
  await signIn(page, desk.email);
  await page.getByRole('link', { name: 'Prices' }).click();
  await expect(row(page, 'price-item', 'Consultation')).toContainText('₹750');
  await expect(page.getByRole('link', { name: 'Add a price' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Consultation/ })).toHaveCount(0);
  await page.goto('/app/prices/items/new');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});

test('a physiotherapist sees no prices', async ({ page }) => {
  const physio = await temporaryWithCode('physiotherapist');
  await signInWithCode(page, physio.email, physio.secret);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Prices' })).toHaveCount(0);
  await page.goto('/app/prices');
  await expect(page).toHaveURL(/\/app\/not-allowed/);
});
