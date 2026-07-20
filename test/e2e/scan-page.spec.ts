import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";
import {
  createGitHubFetchHandler,
  createReactProjectArchive,
} from "./github-fixtures";

const VIEWPORTS = [
  { height: 820, label: "mobile-320", width: 320 },
  { height: 820, label: "mobile-375", width: 375 },
  { height: 900, label: "tablet", width: 768 },
  { height: 1000, label: "desktop", width: 1440 },
] as const;
const ACTIONABLES_TAB_NAME = /Actionables/;
const ALL_CHECKS_TAB_NAME = /All checks/;
const DARK_CLASS_NAME = /dark/;
const RULE_LABEL = /^Rule /;

const visitScanPage = async (
  page: Page,
  clientAddress: string
): Promise<void> => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": clientAddress });
  await page.goto("/scan");
  await expect(
    page.getByRole("heading", { level: 1, name: "Scan a GitHub repository" })
  ).toBeVisible();
};

const getUnexpectedOverflow = (page: Page): Promise<string[]> =>
  page.locator("main").evaluate((main) => {
    const allowedOverflow = new Set(["auto", "clip", "hidden", "scroll"]);
    const issues: string[] = [];

    for (const element of main.querySelectorAll(
      "a, button, code, h1, h2, h3, h4, li, p, [role=tab]"
    )) {
      if (!(element instanceof HTMLElement) || element.offsetParent === null) {
        continue;
      }

      const style = getComputedStyle(element);
      const overflows = element.scrollWidth > element.clientWidth + 1;
      if (overflows && !allowedOverflow.has(style.overflowX)) {
        const slot = element.dataset.slot
          ? `[data-slot=${element.dataset.slot}]`
          : element.tagName.toLowerCase();
        issues.push(`${slot}: ${element.clientWidth}/${element.scrollWidth}`);
      }
    }

    return issues;
  });

const expectNoDocumentOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(await getUnexpectedOverflow(page)).toEqual([]);
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

test("renders the aligned square-ended mark across product surfaces", async ({
  page,
}) => {
  await page.goto("/");
  const mark = page.getByRole("img", { name: "shadscan" });
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("stroke-linecap", "square");
  await expect(mark.locator("g")).toHaveAttribute(
    "transform",
    "translate(3.4 3.4) scale(.864)"
  );
  const slashCenterOffsets = await mark.locator("path").evaluateAll((paths) =>
    paths.slice(-2).map((path) => {
      if (!(path instanceof SVGGeometryElement)) {
        return Number.POSITIVE_INFINITY;
      }
      const center = path.getPointAtLength(path.getTotalLength() / 2);
      return Math.abs(center.x - center.y);
    })
  );
  expect(slashCenterOffsets).toEqual([0, 0]);

  await page.goto("/scan");
  const brandLink = page.getByRole("link", {
    name: "shadscan",
    exact: true,
  });
  await expect(brandLink).toBeVisible();
  await expect(brandLink.locator("svg")).toBeVisible();
});

test("renders the empty state and passes the serious axe gate", async ({
  page,
}) => {
  await visitScanPage(page, "203.0.113.10");

  await expect(page.getByText("No scan yet", { exact: true })).toBeVisible();
  await expect(page.getByLabel("GitHub repository")).toBeEditable();
  await expectNoSevereAxeViolations(page);
});

test("submits with Enter and focuses a validation error", async ({ page }) => {
  await visitScanPage(page, "203.0.113.11");
  const input = page.getByLabel("GitHub repository");

  await input.fill("https://example.com/acme/widget");
  await input.press("Enter");

  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await expect(page.locator("#github-repository-error")).toBeVisible();
});

test("shows an honest reduced-motion pending state", async ({ next, page }) => {
  const archive = await createReactProjectArchive();
  const metadataGate = Promise.withResolvers<void>();
  const repository = "e2e/pending-state";
  next.onFetch(
    createGitHubFetchHandler({
      archive,
      repository,
      repositoryResponse: async () => {
        await metadataGate.promise;
        return new Response(null, { status: 404 });
      },
    })
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visitScanPage(page, "203.0.113.12");
  await page.getByLabel("GitHub repository").fill(repository);

  const submission = page.getByRole("button", { name: "Scan" }).click();
  try {
    await expect(page.getByRole("button", { name: "Scanning" })).toBeDisabled();
    await expect(page.getByLabel("GitHub repository")).toBeDisabled();
    await expect(page.locator('p[aria-live="polite"]')).toHaveText(
      "Scanning repository"
    );
    await expect(page.locator('[data-slot="skeleton"]')).not.toHaveCount(0);
    const animationDurationMs = await page
      .locator('[data-slot="spinner"]')
      .evaluate((spinner) => {
        const duration = getComputedStyle(spinner).animationDuration;
        return duration.endsWith("ms")
          ? Number.parseFloat(duration)
          : Number.parseFloat(duration) * 1000;
      });
    expect(animationDurationMs).toBeLessThanOrEqual(0.01);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches
      )
    ).toBe(true);
  } finally {
    metadataGate.resolve();
  }

  await submission;
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    "The repository could not be found"
  );
});

test("retries an upstream failure and completes the scan", async ({
  next,
  page,
}) => {
  const archive = await createReactProjectArchive();
  const repository = "e2e/retry-state";
  next.onFetch(
    createGitHubFetchHandler({
      archive,
      repository,
      repositoryResponse: (requestCount) =>
        requestCount === 1
          ? new Response(null, { status: 503 })
          : Response.json({ private: false }),
    })
  );
  await visitScanPage(page, "203.0.113.13");
  const input = page.getByLabel("GitHub repository");
  await input.fill(repository);
  await input.press("Enter");

  await expect(page.locator('[data-slot="alert"]')).toContainText(
    "GitHub is temporarily unavailable"
  );
  await expect(input).toHaveValue(repository);
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Scan complete" })
  ).toBeFocused();
  await expect(input).toHaveValue(repository);
});

test("supports result keyboard navigation, copying, and axe", async ({
  next,
  page,
}) => {
  const archive = await createReactProjectArchive();
  const repository = "e2e/complete-state";
  next.onFetch(createGitHubFetchHandler({ archive, repository }));
  await visitScanPage(page, "203.0.113.14");
  await page.getByLabel("GitHub repository").fill(repository);
  await page.getByRole("button", { name: "Scan" }).click();

  const resultHeading = page.getByRole("heading", {
    level: 2,
    name: "Scan complete",
  });
  await expect(resultHeading).toBeFocused();
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(page.locator("article code").first()).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: repository })).toBeFocused();
  await page.keyboard.press("Tab");
  const handoffButton = page.getByRole("button", {
    name: "Copy agent handoff",
  });
  await expect(handoffButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("shadscan");

  const actionablesTab = page.getByRole("tab", {
    name: ACTIONABLES_TAB_NAME,
  });
  const checksTab = page.getByRole("tab", { name: ALL_CHECKS_TAB_NAME });
  await page.keyboard.press("Tab");
  await expect(actionablesTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(checksTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(RULE_LABEL).first()).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(actionablesTab).toHaveAttribute("aria-selected", "true");

  await expectNoSevereAxeViolations(page);
});

test("renders a terminal error and copies the CLI fallback", async ({
  next,
  page,
}) => {
  const archive = await createReactProjectArchive();
  const repository = "e2e/private-state";
  next.onFetch(
    createGitHubFetchHandler({
      archive,
      repository,
      repositoryResponse: () => Response.json({ private: true }),
    })
  );
  await visitScanPage(page, "203.0.113.15");
  await page.getByLabel("GitHub repository").fill(repository);
  await page.getByRole("button", { name: "Scan" }).click();

  await expect(page.locator('[data-slot="alert"]')).toContainText(
    "supports public repositories only"
  );
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy local scan command" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("npx @shadscan/cli@next");
});

test("keeps result fixtures contained across target widths and themes", async ({
  next,
  page,
}, testInfo) => {
  const archive = await createReactProjectArchive();
  const repository =
    "e2e/repository-interface-with-an-intentionally-long-name-repository-interface-with-a-long-name";
  next.onFetch(createGitHubFetchHandler({ archive, repository }));
  await page.emulateMedia({ colorScheme: "light" });
  await visitScanPage(page, "203.0.113.16");
  const initialEmptyHtml = await page
    .locator('[data-slot="empty"]')
    .evaluate((empty) => empty.outerHTML);
  await page.getByLabel("GitHub repository").fill(repository);
  await page.getByRole("button", { name: "Scan" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Scan complete" })
  ).toBeVisible();
  await page
    .locator("article")
    .first()
    .evaluate((firstArticle) => {
      const report = firstArticle.parentElement;
      if (!report) {
        throw new Error("Actionables report was not found.");
      }

      const longSegment =
        "repository-interface-with-an-intentionally-long-name";
      const evidence = firstArticle.querySelector("code");
      if (evidence) {
        evidence.textContent = `app/${longSegment}/${longSegment}/${longSegment}/page.tsx:123`;
      }

      for (let index = 1; index < 18; index += 1) {
        const clone = firstArticle.cloneNode(true);
        if (clone instanceof HTMLElement) {
          const heading = clone.querySelector("h3");
          if (heading) {
            heading.textContent = `Additional actionable ${index + 1}`;
          }
          report.append(clone);
        }
      }
    });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(DARK_CLASS_NAME);
    await expectNoDocumentOverflow(page);

    if (viewport.width === 320 || viewport.width === 1440) {
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: testInfo.outputPath(`${viewport.label}-light.png`),
      });
    }

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(DARK_CLASS_NAME);
    await expectNoDocumentOverflow(page);

    if (viewport.width === 320 || viewport.width === 1440) {
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: testInfo.outputPath(`${viewport.label}-dark.png`),
      });
    }
  }

  await page.setViewportSize({ height: 820, width: 320 });
  await page.emulateMedia({ colorScheme: "light" });
  await page
    .locator("section[aria-labelledby=scan-result-heading]")
    .evaluate((result, emptyHtml) => {
      const score = result.querySelector("span.text-4xl");
      if (score) {
        score.textContent = "Unassessed";
      }
      const grade = [...result.querySelectorAll("span")].find((element) =>
        element.textContent?.startsWith("Grade ")
      );
      if (grade) {
        grade.textContent = "Grade not assigned";
      }
      const panel = result.querySelector('[role="tabpanel"]');
      if (panel) {
        panel.innerHTML = emptyHtml;
        const title = panel.querySelector('[data-slot="empty-title"]');
        if (title) {
          title.textContent = "No actionables";
        }
      }
    }, initialEmptyHtml);
  await expect(page.getByText("Unassessed", { exact: true })).toBeVisible();
  await expect(page.getByText("No actionables", { exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page);
});
