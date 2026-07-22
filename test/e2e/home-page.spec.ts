import { expect, test } from "@playwright/test";

const DESKTOP_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 900, width: 1440 },
] as const;

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`landing page fits the ${viewport.width}x${viewport.height} desktop viewport without vertical scroll`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Deterministic UI audits for shadcn apps",
      })
    ).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(dimensions.scrollHeight).toBeLessThanOrEqual(
      dimensions.clientHeight
    );
  });
}
