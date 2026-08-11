import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { AGENT_AUDIT_PROMPT } from "../../lib/agent-prompt";

const DESKTOP_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 900, width: 1440 },
] as const;

const expectNoDocumentOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const expectNoSeverePromptAxeViolations = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page })
    .include('[data-slot="collapsible-code"]')
    .analyze();
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

test("shows and copies the full project-aware prompt from a ten-line preview", async ({
  page,
}) => {
  await page.setViewportSize({ height: 820, width: 320 });
  await page.goto("/");

  await page.getByRole("tab", { exact: true, name: "prompt" }).click();
  const prompt = page.locator('[data-pm="prompt"] [data-slot="code-block"]');
  const readMore = page.getByRole("button", {
    exact: true,
    name: "Read more",
  });

  await expect(readMore).toHaveAttribute("aria-expanded", "false");
  const controlledRegion = await getControlledRegion(page, readMore);
  expect(await controlledRegion.innerText()).toContain("--prompt");
  expect(await controlledRegion.innerText()).not.toContain("--check-overflow");
  const collapsedMetrics = await getPromptHeightMetrics(prompt);
  expect(collapsedMetrics.scrollHeight).toBeGreaterThan(
    collapsedMetrics.clientHeight
  );
  expect(
    Math.abs(collapsedMetrics.clientHeight - collapsedMetrics.lineHeight * 10)
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { exact: true, name: "Copy" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(AGENT_AUDIT_PROMPT);

  await expectNoDocumentOverflow(page);
  await expectNoSeverePromptAxeViolations(page);

  await readMore.focus();
  await readMore.press("Enter");
  const readLess = page.getByRole("button", {
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

  await expect(prompt).toContainText("--prompt");
  await expect(prompt).toContainText("--check-overflow");
  await expect(prompt).toContainText("monorepo");
  await expect(prompt).toContainText("production");
  await expect(prompt).toContainText("approval");
  await expect(prompt).not.toContainText("localhost");
  await expect(prompt).not.toContainText("/dashboard");
  expect(await controlledRegion.innerText()).toBe(AGENT_AUDIT_PROMPT);

  await expectNoDocumentOverflow(page);
  await expectNoSeverePromptAxeViolations(page);

  await readLess.press("Space");
  const collapsedControl = page.getByRole("button", {
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
  await expectNoDocumentOverflow(page);
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
