import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import ruleCatalog from "@/lib/generated/rule-catalog.json" with {
  type: "json",
};

const RULE_SELECTOR = "main article[id]";
const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

test("renders every generated rule in its canonical category", async ({
  page,
}) => {
  await page.goto("/rules");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Rules",
    })
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { exact: true, name: "Rules" })
  ).toHaveCount(0);

  const renderedRules = page.locator(RULE_SELECTOR);
  await expect(renderedRules).toHaveCount(ruleCatalog.rules.length);

  const renderedRuleIds = await renderedRules.evaluateAll((rules) =>
    rules.map((rule) => rule.id)
  );
  expect(new Set(renderedRuleIds)).toEqual(
    new Set(ruleCatalog.rules.map((rule) => rule.id))
  );

  for (const category of ruleCatalog.categories) {
    const categorySection = page.locator(`#category-${category.id}`);
    const categoryRules = ruleCatalog.rules.filter(
      (rule) => rule.category === category.id
    );

    await expect(categorySection).toBeVisible();
    await expect(
      categorySection.getByRole("heading", {
        // Accordion headers render as h3 via Radix Accordion.Header.
        level: 3,
        name: category.title,
      })
    ).toBeVisible();
    await expect(categorySection.locator("article[id]")).toHaveCount(
      categoryRules.length
    );
  }

  for (const rule of ruleCatalog.rules) {
    const ruleEntry = page.locator(`article#${rule.id}`);

    await expect(ruleEntry).toHaveCount(1);
    await expect(
      ruleEntry.getByRole("heading", { level: 3, name: rule.title })
    ).toBeVisible();
    await expect(ruleEntry).toContainText(rule.description);
    await expect(
      ruleEntry.getByRole("link", { name: rule.title })
    ).toHaveAttribute("href", `#${rule.id}`);
  }

  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
});

test("exposes stable anchors for individual rules", async ({ page }) => {
  const ruleId = "command-menu-present";

  await page.goto(`/rules#${ruleId}`);

  await expect(page.locator(`article#${ruleId}`)).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#${ruleId}`);
});

for (const viewport of VIEWPORTS) {
  test(`fits the rules page at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/rules");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Rules",
      })
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
