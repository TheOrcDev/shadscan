import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

test("documents the agent-only commit workflow", async ({ page }) => {
  await page.goto("/docs");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Make agents run Shadscan before every commit",
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
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
    page.getByText("The skill changes agent behavior only.", { exact: false })
  ).toBeVisible();

  const protocol = page.locator("#protocol");
  await protocol.getByRole("tab", { name: "bun", exact: true }).click();
  await expect(protocol.locator('[data-slot="code-block"]')).toContainText(
    "bunx @shadscan/cli@next --json"
  );
  await protocol.getByRole("tab", { name: "yarn", exact: true }).click();
  await expect(protocol.locator('[data-slot="code-block"]')).toContainText(
    "yarn dlx --quiet --package @shadscan/cli@next shadscan --json"
  );

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
