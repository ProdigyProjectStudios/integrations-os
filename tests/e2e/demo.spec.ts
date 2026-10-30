import { test, expect } from '@playwright/test';
// The owner regression project supplies simulated gateway identity headers.
// Explicitly remove that identity for all anonymous demo browser checks.
test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': '', 'oai-authenticated-user-email': '' } });

test('visitor builds a graph, runs the sandbox engine and inspects its persisted output without admin access', async ({ page, browser }, testInfo) => {
  await page.goto('/portfolio');
  await page.getByRole('link', { name: 'Launch Workflow Studio' }).click();
  await expect(page.getByLabel('Select workflow')).toBeVisible();
  await expect(page.locator('.app-shell.is-demo')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Build the flow.*See the proof/i })).toBeVisible();
  await expect(page.locator('.demo-intro-shader')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Explore the canvas' })).toHaveAttribute('href', '#workflow-studio');
  await expect(page.locator('.sidebar .integration-brand-symbol')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute('href', 'https://github.com/ProdigyProjectStudios/integrations-os');
  await page.getByRole('button', { name: 'Command Center' }).click();
  await expect(page.locator('.page-heading h1')).toContainText('Command Center');
  await page.locator('.sidebar nav button[data-demo-view="studio"]').click();
  await expect(page.getByLabel('Select workflow')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Integration Hub', exact: true })).toHaveCount(0);
  await page.getByTitle('Workflow settings', { exact: true }).click();
  await expect(page.locator('option[value="live"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Transform', exact: true }).click();
  await page.getByLabel('Step name', { exact: true }).fill('Visitor proof');
  await page.getByLabel('Field', { exact: true }).fill('marker');
  await page.getByLabel('Operation', { exact: true }).selectOption('set');
  await page.getByLabel('Value', { exact: true }).fill('public-engine-proof');
  await page.getByRole('button', { name: 'Close step configuration', exact: true }).click();
  await page.locator('.react-flow__controls-fitview').click();
  const node = page.locator('.react-flow__node').filter({ hasText: 'Visitor proof' });
  const source = await page.locator('.react-flow__node[data-id="notify"] .react-flow__handle.source').boundingBox();
  const target = await node.locator('.react-flow__handle.target').boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await page.getByTitle('Auto arrange', { exact: true }).click();
  await page.getByRole('button', { name: 'Publish version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Version published');
  await page.getByLabel('Test company').fill('Visitor sample');
  await page.getByRole('button', { name: 'Test run', exact: true }).click();
  await expect(page.locator('.studio-runbar strong')).toHaveText('success');
  await page.getByRole('button', { name: 'Inspect trace', exact: true }).click();
  await page.getByRole('button', { name: /Visitor proof transform/ }).click();
  await expect(page.locator('.span-detail pre')).toContainText('public-engine-proof');
  const snapshot = await (await page.request.get('/api/demo/snapshot')).json();
  expect(snapshot.runs).toHaveLength(1);
  expect(snapshot.maintenance).toBeNull();
  expect(snapshot.runs[0].mode).toBe('sandbox');
  const second = await browser.newContext({ extraHTTPHeaders: { 'oai-authenticated-user-id': '', 'oai-authenticated-user-email': '' } });
  try {
    const session = await second.request.post('http://127.0.0.1:5180/api/demo/session', { headers: { Origin: 'http://127.0.0.1:5180' }, data: {} });
    expect(session.ok()).toBe(true);
    const hidden = await second.request.get('http://127.0.0.1:5180/api/demo/executions/' + snapshot.runs[0].id);
    expect(hidden.status()).toBe(404);
    expect((await second.request.get('http://127.0.0.1:5180/api/snapshot')).status()).toBe(401);
    expect((await second.request.get('http://127.0.0.1:5180/api/demo/ops/members')).status()).toBe(403);
  } finally { await second.close(); }
  await page.reload();
  await expect(page.getByText('Visitor sample', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('public-demo-inspector.png'), fullPage: true });
});
