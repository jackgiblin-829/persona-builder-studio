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
  await expect(workflow.getByRole("link", { name: /Query Funnels/ })).toBeVisible();
  await workflow.getByRole("link", { name: /Query Funnels/ }).click();
  await expect(page.getByRole("link", { name: /Download demo baseline/ })).toBeVisible();

  const editorSummary = page.getByText("Edit or regenerate this prompt", { exact: true }).first();
  const editor = editorSummary.locator("xpath=..");
  await editorSummary.click();
  const promptInput = editor.getByLabel("Prompt text");
  const currentText = await promptInput.inputValue();
  const draftText = `${currentText.replace(/\?$/, "")} with a new review constraint?`.slice(0, 500);
  await promptInput.fill(draftText);
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/draft saved/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest quality draft" })).toBeVisible();
  await expect(page.getByText(currentText, { exact: true }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Download demo baseline/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath!, "utf8");
  expect(csv).toContain(currentText);
  expect(csv).not.toContain(draftText);

  const legacy = await page.request.get("/brands/legacy");
  expect(legacy.status()).toBe(404);
});

test("create project, ingest transcripts, generate, edit, and preserve a failed draft", async ({
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
  await expect(page.getByText(/3 sources (queued|uploaded and processed)/i)).toBeVisible();

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

  await page.getByRole("button", { name: "Build personas" }).click();
  await expect(page.getByText(/personas built from the latest brand evidence/i)).toBeVisible();
  await page.goto(`${projectPath}/personas`);
  const personaHeadings = page.getByRole("heading", { level: 2 });
  await expect
    .poll(
      async () => {
        await page.reload();
        return personaHeadings.count();
      },
      { timeout: 90_000, message: "persona generation should publish three to five profiles" },
    )
    .toBeGreaterThanOrEqual(3);
  expect(await personaHeadings.count()).toBeLessThanOrEqual(5);
  await expect(page.getByText(/aggregate audience distributions/i).first()).toBeAttached();

  const firstEditorSummary = page.getByText(/Edit sections and create version \d+/i).first();
  const firstEditor = firstEditorSummary.locator("xpath=..");
  await firstEditorSummary.click();
  await firstEditor
    .getByLabel("Summary")
    .fill(
      "Edited acceptance summary grounded in the completed project research and aggregate SparkToro audience distributions.",
    );
  await firstEditor.getByRole("button", { name: "Save new version" }).click();
  await expect(firstEditor.getByText(/new persona version saved/i)).toBeVisible();

  await page.goto(`${projectPath}/prompts`);
  await page.getByText(/Advanced: edit funnel settings/i).click();
  await page.getByLabel("Parent company").fill("Example Holdings");
  await page.getByLabel("Competitors").fill("Example Rival\nExample Alternative");
  await page.getByRole("button", { name: "Save prompt strategy" }).click();
  await expect(page.getByText(/Query Funnel strategy saved/i)).toBeVisible();
  await page.getByText(/Advanced: review persona grounding/i).click();
  await page.getByRole("button", { name: "Build grounding brief" }).click();
  await expect(page.getByText(/persona grounding refreshed/i)).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText(/draft v\d+/i).count();
      },
      { timeout: 90_000, message: "market research should produce an approvable draft" },
    )
    .toBe(1);
  await page.getByText(/Advanced: review persona grounding/i).click();
  await page.getByRole("button", { name: "Approve and freeze" }).click();
  await expect(page.getByText(/approved v\d+/i)).toBeVisible();
  await page.getByRole("button", { name: "Build demo Query Funnels" }).click();
  await expect(page.getByText(/Query Funnels built and quality-checked/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest quality draft" })).toBeVisible();
  await expect(page.getByText(/need revision/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Download demo baseline/ })).toHaveCount(0);
});
