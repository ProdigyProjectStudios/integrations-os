import { test, expect } from '@playwright/test';

test('public portfolio displays recorded engine traces without administrative controls', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: /Every system.*perfect sync/i })).toBeVisible();
  await expect(page.locator('.portfolio-silk-canvas')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Launch Workflow Studio/i })).toBeVisible();
  await expect(page.getByText('workflow.execute', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Execution 02/ }).click();
  await expect(page.getByRole('button', { name: /Execution 02/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button')).toHaveCount(3);
  await expect(page.getByText('Workspace operations', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /publish|replay|connect|approve|delete|run workflow/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
