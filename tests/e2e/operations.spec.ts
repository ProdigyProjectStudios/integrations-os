import { test, expect } from "@playwright/test";
test("workspace operations creates a verified backup and previews retention without deleting data", async ({
  page,
}, testInfo) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|violates.*directive/.test(m.text())
    )
      violations.push(m.text());
  });
  const response = await page.goto("/?view=overview");
  expect(response?.headers()["content-security-policy"]).toContain(
    "'strict-dynamic'",
  );
  await expect(
    page.getByRole("heading", { name: "Command Center." }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Workspace settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace operations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Members", exact: true }).click();
  await page
    .getByLabel("Invite email", { exact: true })
    .fill("browser-invite@example.test");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.getByLabel("Invitation code to share")).not.toBeEmpty();
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.getByLabel("hubspot sync mode")).toHaveValue("0");
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page
    .getByRole("button", { name: "Create verified backup", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Backup verified");
  await page
    .getByRole("button", { name: "Preview retention", exact: true })
    .click();
  await expect(page.getByText("0 completed executions qualify.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply retention cleanup", exact: true }),
  ).toBeDisabled();
  expect(violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("workspace-operations.png"),
    fullPage: true,
  });
});
