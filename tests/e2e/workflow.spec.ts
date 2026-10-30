import { test, expect } from "@playwright/test";
test("an event executes, persists through reload, and exposes its real spans", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Command Center." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /reference events/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run workflow", exact: true }).click();
  const company = `Browser QA ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("Company", { exact: true }).fill(company);
  await page
    .getByRole("button", { name: "Execute workflow", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".waterfall .badge")).toHaveText("Success");
  await page.getByRole("button", { name: "Open full inspector" }).click();
  await expect(
    page.getByRole("heading", { name: "Execution Inspector." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /slack.deliver sandbox|Notify sales slack/ })
    .click();
  await expect(page.locator(".span-detail pre")).toContainText("test-adapter");
  await expect(page.locator(".span-detail pre")).toContainText(
    '"delivered": true',
  );
  await page.getByRole("button", { name: "input", exact: true }).click();
  await expect(page.locator(".span-detail pre")).toContainText(company);
  const before = await page.locator(".trace-meta code").innerText();
  await page.reload();
  await expect(page.locator(".trace-meta code")).toHaveText(before);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("execution-inspector.png"),
    fullPage: true,
  });
  await page.goto("/?view=overview");
  await expect(page.locator(".waterfall .badge")).toHaveText("Success");
  await page.screenshot({
    path: testInfo.outputPath("command-center.png"),
    fullPage: true,
  });
});
test("workflow rules publish a version and integration setup is explicit", async ({
  page,
}, testInfo) => {
  await page.goto("/?view=studio");
  await expect(
    page.getByRole("heading", { name: "Workflow Studio." }),
  ).toBeVisible();
  await page.getByTitle("Workflow settings", { exact: true }).click();
  await expect(page.getByLabel("Workflow name", { exact: true })).toBeVisible();
  const versionButton = page.getByRole("button", { name: /Publish version/ });
  await versionButton.click();
  await expect(page.getByRole("status")).toContainText("Version published");
  await page.goto("/?view=integrations");
  await expect(
    page.getByRole("heading", { name: "Integration Hub." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test adapter", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Test adapter health check completed",
  );
  // Regression: framework routing once returned 200 with an empty JSON body.
  for (let i = 0; i < 5; i++) {
    const response = await page.request.post("/api/connections/gmail/sync", {
      headers: { Origin: "http://127.0.0.1:5180" },
      data: {},
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).mode).toBe("sandbox");
  }
  await page
    .getByRole("button", { name: "Set up OAuth", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("TOKEN_ENCRYPTION_KEY");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
