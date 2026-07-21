import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const LEGAL_PAGES = [
  {
    lastUpdated: "2026-07-21",
    path: "/privacy",
    title: "Privacy Policy",
    visibleStatements: [
      "The Shadscan CLI runs locally.",
      "We enable Vercel Web Analytics",
      "Neon Postgres stores those digests",
    ],
  },
  {
    lastUpdated: "2026-07-21",
    path: "/terms",
    title: "Terms of Service",
    visibleStatements: ["Scan results are guidance"],
  },
] as const;

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

for (const legalPage of LEGAL_PAGES) {
  test(`renders the ${legalPage.title} and legal footer`, async ({ page }) => {
    await page.goto(legalPage.path);

    await expect(
      page.getByRole("heading", { level: 1, name: legalPage.title })
    ).toBeVisible();
    for (const visibleStatement of legalPage.visibleStatements) {
      await expect(page.getByText(visibleStatement)).toBeVisible();
    }
    await expect(page.locator("time")).toHaveAttribute(
      "datetime",
      legalPage.lastUpdated
    );
    await expect(
      page.getByRole("link", { name: "orc@orcdev.com" }).last()
    ).toHaveAttribute("href", "mailto:orc@orcdev.com");

    const legalNavigation = page.getByRole("navigation", { name: "Legal" });
    await expect(
      legalNavigation.getByRole("link", { name: "Privacy" })
    ).toHaveAttribute("href", "/privacy");
    await expect(
      legalNavigation.getByRole("link", { name: "Terms" })
    ).toHaveAttribute("href", "/terms");

    const results = await new AxeBuilder({ page }).analyze();
    const severeViolations = results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical"
    );
    expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
      []
    );
  });
}

for (const viewport of VIEWPORTS) {
  test(`fits the legal pages at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);

    for (const legalPage of LEGAL_PAGES) {
      await page.goto(legalPage.path);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth
      );
    }
  });
}
