import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

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
    page
      .locator("#options dt")
      .getByText("--check-overflow <url>", { exact: true })
  ).toBeVisible();
  await expect(page.getByText("production-polish")).toBeVisible();

  const overflowCheck = page.locator("#overflow-check");
  await expect(overflowCheck).toContainText(
    "--check-overflow http://localhost:3000 --route /dashboard"
  );
  await expect(overflowCheck).toContainText("Mobile: 320 × 820");
  await expect(overflowCheck).toContainText("Desktop: 1440 × 1000");
  await expect(overflowCheck).toContainText(
    "standalone rendered check, not another source-audit rule"
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

  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
});

for (const viewport of VIEWPORTS) {
  test(`fits the docs at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/docs");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
