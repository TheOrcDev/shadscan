import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { AGENT_AUDIT_PROMPT } from "../../lib/agent-prompt";

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

const expectNoDocumentOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const expectNoSevereAxeViolations = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
};

const getControlledRegion = async (
  page: Page,
  control: Locator
): Promise<Locator> => {
  const controlledId = await control.getAttribute("aria-controls");
  if (!controlledId) {
    throw new Error(
      "The prompt disclosure must identify its controlled region"
    );
  }
  const controlledRegion = page.locator(`[id=${JSON.stringify(controlledId)}]`);
  await expect(controlledRegion).toHaveCount(1);
  return controlledRegion;
};

const getPromptHeightMetrics = (
  controlledRegion: Locator
): Promise<{
  clientHeight: number;
  lineHeight: number;
  scrollHeight: number;
}> =>
  controlledRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    scrollHeight: element.scrollHeight,
  }));

test("expands and copies the full recommended prompt from a ten-line preview", async ({
  page,
}) => {
  await page.goto("/docs");

  const usage = page.locator("#usage");
  const readMore = usage.getByRole("button", {
    exact: true,
    name: "Read more",
  });
  const prompt = usage.locator('code[data-language="text"]');

  await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(1);
  await expect(readMore).toHaveAttribute("aria-expanded", "false");
  const controlledRegion = await getControlledRegion(page, readMore);
  expect(await controlledRegion.innerText()).toContain("--prompt");
  expect(await controlledRegion.innerText()).not.toContain("--check-ui");
  const collapsedMetrics = await getPromptHeightMetrics(prompt);
  expect(collapsedMetrics.scrollHeight).toBeGreaterThan(
    collapsedMetrics.clientHeight
  );
  expect(
    Math.abs(collapsedMetrics.clientHeight - collapsedMetrics.lineHeight * 10)
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { exact: true, name: "Copy Prompt" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(AGENT_AUDIT_PROMPT);
  await expectNoSevereAxeViolations(page);

  await readMore.focus();
  await readMore.press("Enter");
  const readLess = usage.getByRole("button", {
    exact: true,
    name: "Read less",
  });
  await expect(readLess).toBeFocused();
  await expect(readLess).toHaveAttribute("aria-expanded", "true");
  const expandedMetrics = await getPromptHeightMetrics(prompt);
  expect(expandedMetrics.clientHeight).toBeGreaterThan(
    collapsedMetrics.clientHeight
  );
  expect(expandedMetrics.scrollHeight).toBeLessThanOrEqual(
    expandedMetrics.clientHeight + 1
  );
  expect(await controlledRegion.innerText()).toBe(AGENT_AUDIT_PROMPT);
  await expectNoSevereAxeViolations(page);

  await readLess.press("Space");
  const collapsedControl = usage.getByRole("button", {
    exact: true,
    name: "Read more",
  });
  await expect(collapsedControl).toBeFocused();
  await expect(collapsedControl).toHaveAttribute("aria-expanded", "false");
  const recollapsedMetrics = await getPromptHeightMetrics(prompt);
  expect(recollapsedMetrics.clientHeight).toBe(collapsedMetrics.clientHeight);
  expect(recollapsedMetrics.scrollHeight).toBeGreaterThan(
    recollapsedMetrics.clientHeight
  );
});

test("documents the CLI before the optional agent workflow", async ({
  page,
}) => {
  await page.goto("/docs");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Shadscan CLI",
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
  await expect(
    page.locator("article > header").locator('[data-slot="code-block"]')
  ).toContainText("pnpm dlx @shadscan/cli");
  const publicAgentPrompt = page.locator('#usage code[data-language="text"]');
  await page
    .locator("#usage")
    .getByRole("button", { exact: true, name: "Read more" })
    .click();
  await expect(publicAgentPrompt).toContainText("--prompt");
  await expect(publicAgentPrompt).toContainText("--check-ui");
  await expect(publicAgentPrompt).not.toContainText("--check-overflow");
  await expect(publicAgentPrompt).toContainText("monorepo");
  await expect(publicAgentPrompt).toContainText("production");
  await expect(publicAgentPrompt).toContainText("approval");
  await expect(publicAgentPrompt).not.toContainText("localhost");
  await expect(publicAgentPrompt).not.toContainText("/dashboard");
  await expect(
    page.locator("#options dt").getByText("--prompt", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("#options dt").getByText("--json", { exact: true })
  ).toBeVisible();
  await expect(
    page
      .locator("#options dt")
      .getByText("--fail-under <score>", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("#options dt").getByText("--apply", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("#options dt").getByText("--agent <agent>", { exact: true })
  ).toBeVisible();
  await expect(
    page.locator("#options dt").getByText("--check-ui <url>", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "UI checks" })
  ).toHaveAttribute("href", "#ui-check");
  await expect(page.getByText("production-polish")).toBeVisible();

  const uiCheck = page.locator("#ui-check");
  await expect(uiCheck).toContainText(
    "--check-ui http://localhost:3000 --route /dashboard"
  );
  await expect(uiCheck).toContainText("Mobile: 320 × 820");
  await expect(uiCheck).toContainText("Desktop: 1440 × 1000");
  await expect(uiCheck).toContainText(
    "rendered UI suite, not another source-audit rule"
  );
  await expect(uiCheck).toContainText("server-side canonical redirects");
  await expect(uiCheck).toContainText(
    "client-side cross-origin navigations remain blocked"
  );
  await expect(uiCheck).toContainText(
    "human output also identifies the originally requested origin"
  );

  const agentPrompt = page.locator("#agent-prompt");
  await agentPrompt.getByRole("tab", { name: "bun", exact: true }).click();
  await expect(agentPrompt.locator('[data-slot="code-block"]')).toContainText(
    "bunx @shadscan/cli --prompt"
  );
  await agentPrompt.getByRole("tab", { name: "yarn", exact: true }).click();
  await expect(agentPrompt.locator('[data-slot="code-block"]')).toContainText(
    "yarn dlx --quiet --package @shadscan/cli shadscan --prompt"
  );

  await expect(page.locator("#apply")).toContainText("--apply --agent codex");
  await expect(page.locator("#pre-commit")).toContainText(
    "setup --pre-commit --dry-run"
  );

  await expect(page.getByText("shadscan-pre-commit").first()).toBeVisible();
  await expect(
    page
      .locator('[data-slot="code-block"]')
      .filter({
        hasText: "TheOrcDev/skills --skill shadscan-pre-commit",
      })
      .first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy AGENTS.md" })
  ).toBeVisible();
  await expect(
    page.getByText("It adds no Git hook or project dependency", {
      exact: false,
    })
  ).toBeVisible();

  await expectNoSevereAxeViolations(page);
});

for (const viewport of VIEWPORTS) {
  test(`fits the docs at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/docs");

    await expectNoDocumentOverflow(page);
    await page
      .locator("#usage")
      .getByRole("button", { exact: true, name: "Read more" })
      .click();
    await expectNoDocumentOverflow(page);
  });
}
