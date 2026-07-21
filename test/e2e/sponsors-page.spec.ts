import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TIERS = [
  { name: "Diamond", slots: 4 },
  { name: "Platinum", slots: 6 },
  { name: "Gold", slots: 8 },
  { name: "Silver", slots: 12 },
] as const;

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

test("shows every sponsorship tier and slot", async ({ page }) => {
  await page.goto("/sponsors");

  await expect(
    page.getByRole("heading", { level: 1, name: "Sponsor shadscan" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "Sponsors" })
  ).toHaveAttribute("aria-current", "page");

  for (const tier of TIERS) {
    const section = page.getByRole("region", {
      name: `${tier.name} sponsors`,
    });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("link", {
        name: new RegExp(`Sponsor shadscan at the ${tier.name} tier`),
      })
    ).toHaveCount(tier.slots);
  }

  await expect(
    page.getByRole("link", {
      name: "Sponsor shadscan at the Diamond tier, slot 1",
    })
  ).toHaveAttribute(
    "href",
    "mailto:sponsors@shadscan.com?subject=shadscan%20Diamond%20sponsorship"
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
  test(`fits the sponsors page at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/sponsors");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
