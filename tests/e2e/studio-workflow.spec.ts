import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("analyst@example.com");
  await page.getByLabel("Password").fill("demo-password-2");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/projects/);
}

test("seeded three-tab workflow and legacy 404", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /Northwind Enterprise Platform/ }).click();
  await expect(page).toHaveURL(/\/projects\/prj_northwind\/data/);
  const workflow = page.getByRole("navigation", { name: "Project workflow" });
  await expect(workflow.getByRole("link", { name: /Data/ })).toBeVisible();
  await expect(workflow.getByRole("link", { name: /Personas/ })).toBeVisible();
  await expect(workflow.getByRole("link", { name: /Prompts/ })).toBeVisible();
  await workflow.getByRole("link", { name: /Prompts/ }).click();
  await expect(page.getByRole("link", { name: /Download demo CSV/ })).toBeVisible();
  const legacy = await page.request.get("/brands/legacy");
  expect(legacy.status()).toBe(404);
});

test("create project, ingest several transcripts, generate, edit, fan out, and export", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);

  const unique = Date.now();
  await page.getByRole("link", { name: /new project/i }).click();
  await page.getByLabel("Project name").fill(`Acceptance Research ${unique}`);
  await page.getByLabel("Domain").fill(`acceptance-${unique}.example`);
  await page
    .getByLabel("Product or service")
    .fill(
      "A secure workflow platform that helps enterprise operations teams evaluate, govern, and automate complex approval processes.",
    );
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
  const projectPath = new URL(page.url()).pathname.replace(/\/data$/, "");

  const transcript = (role: string, concern: string) =>
    [
      `${role}: Our current approval workflow creates delays across several departments.`,
      `Interviewer: What makes replacing it difficult for the team right now?`,
      `${role}: ${concern} is the biggest concern and every claim needs credible proof.`,
      `${role}: We compare implementation effort, security controls, and total operating cost.`,
      `${role}: Success means cutting cycle time while preserving governance and auditability.`,
      `${role}: We need references from organizations with a similar operating model.`,
      `${role}: Procurement will object if pricing or rollout requirements remain unclear.`,
      `${role}: Contact me at buyer@example.com or 212-555-0199 for the follow-up.`,
    ].join("\n");

  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: `security-${unique}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(transcript("Security lead", "Evidence about access controls")),
    },
    {
      name: `operations-${unique}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(transcript("Operations director", "Change management capacity")),
    },
    {
      name: `procurement-${unique}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(transcript("Procurement partner", "Commercial and vendor risk")),
    },
  ]);
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page.getByText(/3 sources queued/i)).toBeVisible();

  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText(/^completed$/i).count();
      },
      { timeout: 60_000, message: "all uploaded transcripts should complete ingestion" },
    )
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByText(/redactions/).first()).toBeVisible();

  await page
    .getByLabel("SparkToro audience description")
    .fill(
      "Enterprise security, operations, procurement, and transformation leaders evaluating governed workflow automation in the United States.",
    );
  await page.getByRole("button", { name: "Save description" }).click();
  await expect(page.getByText(/audience description saved/i)).toBeVisible();

  await page.getByRole("button", { name: "Generate personas" }).click();
  await expect(page.getByText(/persona generation started/i)).toBeVisible();
  await page.goto(`${projectPath}/personas`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.locator("details").count();
      },
      { timeout: 90_000, message: "persona generation should publish three to five profiles" },
    )
    .toBeGreaterThanOrEqual(3);
  expect(await page.locator("details").count()).toBeLessThanOrEqual(5);
  await expect(page.getByText(/aggregate audience distributions/i).first()).toBeVisible();

  const firstEditor = page.locator("details").first();
  await firstEditor.locator("summary").click();
  await firstEditor
    .getByLabel("Summary")
    .fill(
      "Edited acceptance summary grounded in the completed project research and aggregate SparkToro audience distributions.",
    );
  await firstEditor.getByRole("button", { name: "Save new version" }).click();
  await expect(firstEditor.getByText(/new persona version saved/i)).toBeVisible();

  await page.goto(`${projectPath}/prompts`);
  await page.getByLabel("Parent company").fill("Example Holdings");
  await page.getByLabel("Competitors").fill("Example Rival\nExample Alternative");
  await page.getByRole("button", { name: "Save prompt strategy" }).click();
  await expect(page.getByText(/prompt strategy saved/i)).toBeVisible();
  await page.getByRole("button", { name: "Research market" }).click();
  await expect(page.getByText(/market research refresh started/i)).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText(/draft v\d+/i).count();
      },
      { timeout: 90_000, message: "market research should produce an approvable draft" },
    )
    .toBe(1);
  await page.getByRole("button", { name: "Approve and freeze" }).click();
  await expect(page.getByText(/approved v\d+/i)).toBeVisible();
  await page.getByRole("button", { name: "Generate demo prompts" }).click();
  await expect(page.getByText(/prompt generation started/i)).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("latest completed").count();
      },
      { timeout: 90_000, message: "every active persona should receive a completed prompt set" },
    )
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Problem discovery").first()).toBeVisible();
  await expect(page.getByText("Implementation and optimization").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download demo CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/prompts\.csv$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv.startsWith('\uFEFF"Topic","Prompt","Tags","Regions","Language"\r\n')).toBe(true);
  expect(csv.trim().split("\r\n")).toHaveLength(51);
  expect(csv).toContain("topic_class:");
  expect(csv).toContain("archetype:");
  expect(csv).toContain("quality_band:");
  expect(csv).toContain("research_snapshot:");
  expect(csv).toContain("generation_mode:mock");
});
