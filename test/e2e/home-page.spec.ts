import { expect, test } from "@playwright/test";

const DESKTOP_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 900, width: 1440 },
] as const;

test("shows the project-aware rendered audit prompt", async ({ page }) => {
  await page.setViewportSize({ height: 820, width: 320 });
  await page.goto("/");

  await page.getByRole("tab", { exact: true, name: "prompt" }).click();
  const prompt = page.locator('[data-pm="prompt"] [data-slot="code-block"]');

  await expect(prompt).toContainText("--prompt");
  await expect(prompt).toContainText("--check-overflow");
  await expect(prompt).toContainText("monorepo");
  await expect(prompt).toContainText("production");
  await expect(prompt).toContainText("approval");
  await expect(prompt).not.toContainText("localhost");
  await expect(prompt).not.toContainText("/dashboard");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

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
