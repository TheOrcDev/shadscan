import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import ruleCatalog from "@/lib/generated/rule-catalog.json" with {
  type: "json",
};

const RULE_CARD_SELECTOR = "[data-rule-id]";
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
      name: "Every rule Shadscan checks",
    })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "Rules" })
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("status")).toHaveText(
    `Showing ${ruleCatalog.rules.length} of ${ruleCatalog.rules.length} rules`
  );

  const ruleCards = page.locator(RULE_CARD_SELECTOR);
  await expect(ruleCards).toHaveCount(ruleCatalog.rules.length);

  const renderedRuleIds = await ruleCards.evaluateAll((cards) =>
    cards.map((card) => card.getAttribute("data-rule-id"))
  );
  expect(new Set(renderedRuleIds)).toEqual(
    new Set(ruleCatalog.rules.map((rule) => rule.id))
  );

  for (const category of ruleCatalog.categories) {
    const categorySection = page.locator(`section#category-${category.id}`);
    const categoryRules = ruleCatalog.rules.filter(
      (rule) => rule.category === category.id
    );

    await expect(categorySection).toBeVisible();
    await expect(
      categorySection.getByRole("heading", {
        level: 2,
        name: new RegExp(category.title),
      })
    ).toBeVisible();
    await expect(categorySection.locator(RULE_CARD_SELECTOR)).toHaveCount(
      categoryRules.length
    );
  }

  for (const rule of ruleCatalog.rules) {
    const ruleCard = page.locator(`[data-rule-id="${rule.id}"]`);

    await expect(ruleCard).toHaveCount(1);
    await expect(
      ruleCard.getByRole("heading", { level: 3, name: rule.title })
    ).toBeVisible();
    await expect(ruleCard).toContainText(rule.description);
  }

  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
});

test("filters rules by canonical id and recovers from an empty result", async ({
  page,
}) => {
  await page.goto("/rules");

  const search = page.getByRole("searchbox", { name: "Search rules" });
  const visibleRuleCards = page.locator(`${RULE_CARD_SELECTOR}:visible`);
  const targetRule = ruleCatalog.rules.find(
    (rule) => rule.id === "command-menu-hotkey-present"
  );

  expect(targetRule).toBeDefined();
  await search.fill(targetRule?.id ?? "command-menu-hotkey-present");

  await expect(visibleRuleCards).toHaveCount(1);
  await expect(
    page.locator('[data-rule-id="command-menu-hotkey-present"]')
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    `Showing 1 of ${ruleCatalog.rules.length} rules`
  );

  await search.fill("a-rule-that-does-not-exist");

  await expect(visibleRuleCards).toHaveCount(0);
  await expect(
    page.getByText("No matching rules", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    `Showing 0 of ${ruleCatalog.rules.length} rules`
  );

  await search.fill("");

  await expect(visibleRuleCards).toHaveCount(ruleCatalog.rules.length);
  await expect(page.getByRole("status")).toHaveText(
    `Showing ${ruleCatalog.rules.length} of ${ruleCatalog.rules.length} rules`
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
        name: "Every rule Shadscan checks",
      })
    ).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
