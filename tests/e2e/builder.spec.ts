import { test, expect, type Page } from "@playwright/test";
test("drafts survive concurrent publication and block accidental navigation", async ({
  page,
}, testInfo) => {
  await fresh(page, `Conflict ${testInfo.project.name} ${Date.now()}`);
  const flowId = await page.getByLabel("Select workflow").inputValue();
  await page.getByTitle("Workflow settings", { exact: true }).click();
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("My unsaved draft");
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("button", { name: "Command Center", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workflow Studio." }),
  ).toBeVisible();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const flow = snapshot.workflows.find((f: { id: string }) => f.id === flowId);
  const response = await page.request.put("/api/workflows", {
    headers: { Origin: "http://127.0.0.1:5180" },
    data: {
      id: flow.id,
      name: "Published elsewhere",
      version: flow.version,
      config: flow.config,
    },
  });
  expect(response.status()).toBe(200);
  await expect(page.locator(".studio-message.error")).toContainText(
    "Your draft is preserved",
  );
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "My unsaved draft",
  );
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.getByLabel("Workflow name", { exact: true })).toHaveValue(
    "Published elsewhere",
  );
});
async function fresh(page: Page, name: string) {
  await page.goto("/?view=studio");
  await expect(page.getByLabel("Select workflow")).toBeVisible();
  if (await page.getByText("Unsaved changes", { exact: true }).isVisible()) {
    await page
      .getByRole("button", { name: "Publish version", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Version published");
  }
  await page.getByTitle("Create workflow", { exact: true }).click();
  await page.getByLabel("New workflow name").fill(name);
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await expect(page.getByLabel("Select workflow")).toContainText(name);
  await expect(
    page.getByLabel("Select workflow").locator("option:checked"),
  ).toHaveText(name);
  await expect(page.locator(".builder-layout")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
test("add, connect, configure, publish and execute a custom node from the canvas", async ({
  page,
}, testInfo) => {
  const name = `Canvas ${testInfo.project.name} ${Date.now()}`;
  await fresh(page, name);
  await page
    .getByRole("button", { name: "Add Transform", exact: true })
    .click();
  await page
    .getByLabel("Step name", { exact: true })
    .fill("Stamp review marker");
  await page.getByLabel("Field", { exact: true }).fill("marker");
  await page.getByLabel("Operation", { exact: true }).selectOption("set");
  await page.getByLabel("Value", { exact: true }).fill("graph-executed");
  await page
    .getByRole("button", { name: "Close step configuration", exact: true })
    .click();
  await page.locator(".react-flow__controls-fitview").click();
  const added = page
    .locator(".react-flow__node")
    .filter({ hasText: "Stamp review marker" });
  const target = added.locator(".react-flow__handle.target");
  const source = page.locator(
    '.react-flow__node[data-id="notify"] .react-flow__handle.source',
  );
  const a = await source.boundingBox(),
    b = await target.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(5);
  // Real pointer dragging persists the layout with the executable definition.
  const box = await added.boundingBox();
  await page.mouse.move(box!.x + 40, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 80, box!.y + 75, { steps: 12 });
  await page.mouse.up();
  await page.getByTitle("Auto arrange", { exact: true }).click();
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Version published");
  const flowId = await page.getByLabel("Select workflow").inputValue();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const saved = snapshot.workflows.find((f: { id: string }) => f.id === flowId);
  expect(saved.config.graph.nodes).toHaveLength(6);
  expect(saved.config.graph.edges).toHaveLength(5);
  await page.getByLabel("Test company").fill("Canvas-driven execution");
  await page.getByRole("button", { name: "Test run", exact: true }).click();
  await expect(page.locator(".studio-runbar strong")).toHaveText("success");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: testInfo.outputPath("workflow-studio.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect trace", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Stamp review marker transform/ })
    .click();
  await expect(page.locator(".span-detail pre")).toContainText(
    "graph-executed",
  );
  await expect(page.locator(".span-detail pre")).toContainText(
    "Canvas-driven execution",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("graph-inspector.png"),
    fullPage: true,
  });
  await page.goto("/?view=overview");
  await expect(page.locator(".waterfall .badge")).toHaveText("Success");
  await page.screenshot({
    path: testInfo.outputPath("command-center-v2.png"),
    fullPage: true,
  });
});
test("imported approval graph pauses, accepts a human decision and continues the same run", async ({
  page,
}, testInfo) => {
  await fresh(page, `Approval ${testInfo.project.name} ${Date.now()}`);
  const graph = {
    nodes: [
      {
        id: "start",
        kind: "trigger",
        label: "Receive",
        position: { x: 50, y: 140 },
        config: {},
      },
      {
        id: "approve",
        kind: "approval",
        label: "Review enquiry",
        position: { x: 370, y: 140 },
        config: { prompt: "Confirm this enquiry is ready for sales." },
      },
      {
        id: "send",
        kind: "slack",
        label: "Deliver approved enquiry",
        position: { x: 690, y: 140 },
        config: {
          channel: "integration-events",
          message: "Approved {{company}}",
        },
      },
    ],
    edges: [
      { id: "one", source: "start", target: "approve" },
      { id: "two", source: "approve", target: "send" },
    ],
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "approval.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ graph })),
  });
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Version published");
  await page.getByRole("button", { name: "Test run", exact: true }).click();
  await expect(page.locator(".studio-runbar strong")).toHaveText(
    "waiting approval",
  );
  await page
    .getByRole("button", { name: "Inspect trace", exact: true })
    .click();
  await expect(
    page.getByText("Confirm this enquiry is ready for sales."),
  ).toBeVisible();
  const traceId = await page.locator(".trace-meta code").innerText();
  await page
    .getByRole("button", { name: "Approve & continue", exact: true })
    .click();
  await expect(page.locator(".waterfall .badge")).toHaveText("Success");
  await expect(page.locator(".trace-meta code")).toHaveText(traceId);
  await page
    .getByRole("button", { name: /Deliver approved enquiry slack/ })
    .click();
  await expect(page.locator(".span-detail pre")).toContainText("test-adapter");
});
