import { test, expect } from '@playwright/test';

test('public portfolio displays recorded engine traces without administrative controls', async ({ page }) => {
  await page.goto('/portfolio');
  const sourceLink = page.getByRole('link', { name: 'View source on GitHub' });
  await expect(sourceLink).toHaveAttribute('href', 'https://github.com/ProdigyProjectStudios/integrations-os');
  // The primary hero retains exactly two actions; the source link is beneath the trust line.
  await expect(page.locator('.portfolio-hero-actions > a')).toHaveCount(2);
  await expect(page.locator('.portfolio-hero-source > a')).toHaveCount(1);
  // The monitor should regain its intended large desktop footprint.
  if ((page.viewportSize()?.width ?? 0) >= 1181) {
    const monitor = await page.locator('.portfolio-hero-panel').boundingBox();
    expect(monitor?.width ?? 0).toBeGreaterThan(640);
  }

  // The header links are intentionally hidden on narrow screens; exercise
  // them when visible and use the public hero CTA on both breakpoints.
  const capabilities = page.getByRole('link', { name: 'Capabilities', exact: true });
  if (await capabilities.isVisible()) {
    await capabilities.click();
    await expect(page).toHaveURL(/#capabilities$/);
  }
  await page.getByRole('link', { name: /Explore execution traces/i }).click();
  await expect(page).toHaveURL(/#inspector$/);

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
