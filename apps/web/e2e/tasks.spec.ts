import { expect, test, type Page } from '@playwright/test';
import { centreId, signIn, signInWithCode, temporaryDesk, temporaryWithCode } from './staff';
import { makeTasks, removeTasks, taskTrail } from './tasks';

// ALT-03 done when: tasks by urgency; closing requires a recorded decision. Decisions (user, 24
// October 2026): the inbox lists tasks, with a line for open red flag alerts on top for those who
// read them; "Take it" takes a role task for oneself, and it leaves everyone else's list. Tasks
// for the HSR Layout desk, with generated titles, are made as the system and removed afterwards.

const made: string[] = [];
test.afterEach(async () => {
  await removeTasks(made.splice(0));
});

const card = (page: Page, title: string) =>
  page.getByTestId('task-card').filter({ has: page.getByText(title, { exact: true }) });

test('the desk sees its tasks by urgency, takes one, and closes it only with a decision', async ({
  page,
  browser,
}) => {
  const supabaseRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.endsWith('supabase.co'))
      supabaseRequests.push(request.url());
  });
  const short = crypto.randomUUID().slice(0, 6);
  const hsr = await centreId('HSR Layout');
  const titles = {
    urgent: `Call back about a missed visit ${short}`,
    overdue: `Confirm tomorrow's slot ${short}`,
    normal: `Send the bill copy ${short}`,
  };
  const desk = { assigneeRole: 'front_desk' as const, centreId: hsr };
  const tasks = await makeTasks([
    { ...desk, title: titles.normal },
    { ...desk, title: titles.overdue, dueAt: new Date(Date.now() - 3600_000) },
    { ...desk, title: titles.urgent, priority: 'urgent', dueAt: new Date(Date.now() + 7200_000) },
  ]);
  made.push(...tasks.map((t) => t.id));
  const idOf = (title: string) => tasks.find((t) => t.title === title)?.id ?? '';

  const deskOne = await temporaryDesk();
  await signIn(page, deskOne.email);
  // The front desk lands on Today; the inbox is linked from Home.
  await page.goto('/app');
  await expect(page.getByTestId('home-tasks')).toContainText('open');
  await page.getByTestId('home-tasks').click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();

  // Most urgent first: the urgent one, then the overdue, then the rest.
  const order = await page
    .getByTestId('open-tasks')
    .getByTestId('task-card')
    .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-task')));
  const ours = order.filter((id) => id && made.includes(id));
  expect(ours).toEqual([idOf(titles.urgent), idOf(titles.overdue), idOf(titles.normal)]);
  await expect(card(page, titles.overdue).getByText('Overdue', { exact: true })).toBeVisible();
  await expect(card(page, titles.urgent).getByTestId('task-holder')).toHaveText(
    'For Front Desk at HSR Layout',
  );

  // Take it: it is now this desk's, and another desk at HSR no longer sees it.
  await card(page, titles.urgent).getByRole('button', { name: 'Take it' }).click();
  await expect(card(page, titles.urgent).getByTestId('task-holder')).toHaveText('Taken by you');
  const other = await (await browser.newContext()).newPage();
  const deskTwo = await temporaryDesk();
  await signIn(other, deskTwo.email);
  await other.goto('/app/tasks');
  await expect(card(other, titles.overdue)).toBeVisible();
  await expect(card(other, titles.urgent)).toHaveCount(0);
  await other.context().close();

  // No decision, no close.
  const urgent = card(page, titles.urgent);
  await urgent.getByText('Close…', { exact: true }).click();
  await urgent.getByRole('button', { name: 'Close with decision' }).click();
  await expect(urgent.getByText('Write the decision before closing.')).toBeVisible();
  await urgent.getByLabel('Decision').fill('Called back; rebooked for Friday');
  await urgent.getByRole('button', { name: 'Close with decision' }).click();
  const closed = page
    .getByTestId('closed-tasks')
    .getByTestId('task-card')
    .filter({
      has: page.getByText(titles.urgent, { exact: true }),
    });
  await expect(closed.getByTestId('task-decision')).toContainText(
    'Called back; rebooked for Friday',
  );
  await expect(card(page, titles.urgent).filter({ has: page.getByRole('button') })).toHaveCount(0);

  const { row, audit } = await taskTrail(idOf(titles.urgent));
  expect(row).toMatchObject({
    status: 'closed',
    closedBy: deskOne.id,
    assigneeStaffUserId: deskOne.id,
  });
  expect(audit.map((a) => a.actor)).toContain(`staff:${deskOne.id}`);
  expect(supabaseRequests).toEqual([]);
});

test('a physio does not see the front desk’s tasks', async ({ page }) => {
  const hsr = await centreId('HSR Layout');
  const title = `For the desk only ${crypto.randomUUID().slice(0, 6)}`;
  const [made1] = await makeTasks([{ assigneeRole: 'front_desk', centreId: hsr, title }]);
  if (made1) made.push(made1.id);
  const physio = await temporaryWithCode('physiotherapist', ['HSR Layout']);
  await signInWithCode(page, physio.email, physio.secret);
  await page.getByTestId('home-tasks').click();
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(card(page, title)).toHaveCount(0);
});
