import { expect } from "@playwright/test";
import { test } from "next/experimental/testmode/playwright.js";

const RULESET_DETAIL_PATTERN = /^ruleset \d{4}\./;
const UNAVAILABLE_PATTERN = /temporarily unavailable/i;

const VIEWPORTS = [
  { height: 820, label: "mobile", width: 320 },
  { height: 900, label: "tablet", width: 768 },
  { height: 900, label: "desktop", width: 1440 },
] as const;

const REGISTRY_PAYLOAD = {
  "dist-tags": { latest: "0.8.0" },
  time: {
    created: "2026-07-22T10:00:00.000Z",
    modified: "2026-07-30T16:00:00.000Z",
    "0.7.0": "2026-07-27T09:00:00.000Z",
    "0.8.0": "2026-07-30T16:00:00.000Z",
  },
};

const RANGE_PAYLOAD = {
  downloads: [
    { day: "2026-07-27", downloads: 1076 },
    { day: "2026-07-28", downloads: 975 },
    { day: "2026-07-29", downloads: 2558 },
  ],
};

/**
 * The page must survive npm being unavailable, so every test drives the
 * outbound calls rather than reaching the real registry.
 */
const createNpmHandler =
  (status = 200) =>
  (request: Request) => {
    const url = request.url;

    if (url.startsWith("https://registry.npmjs.org/")) {
      return Response.json(REGISTRY_PAYLOAD, { status });
    }

    if (url.includes("/downloads/range/")) {
      return Response.json(RANGE_PAYLOAD, { status });
    }

    if (url.includes("/versions/")) {
      return Response.json(
        { downloads: { "0.7.0": 3095, "0.8.0": 2302 } },
        { status }
      );
    }

    if (url.includes("/downloads/point/")) {
      return Response.json({ downloads: 9631 }, { status });
    }

    return "abort" as const;
  };

test("shows npm usage and the bundled ruleset", async ({ next, page }) => {
  next.onFetch(createNpmHandler());

  await page.goto("/stats");

  await expect(
    page.getByRole("heading", { level: 1, name: "Stats" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Downloads per day" })
  ).toBeVisible();

  // The tiles are the non-visual reading of the page, so they are what the
  // test asserts on rather than the rendered SVG. A dt exposes no accessible
  // name, so the tiles are matched by their text rather than by role name.
  await expect(
    page.getByRole("term").filter({ hasText: "Rules" })
  ).toBeVisible();
  await expect(page.getByText(RULESET_DETAIL_PATTERN)).toBeVisible();

  // The per-version breakdown was removed; nothing should reintroduce a table.
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("degrades to a message when npm is unavailable", async ({
  next,
  page,
}) => {
  next.onFetch(createNpmHandler(503));

  await page.goto("/stats");

  await expect(
    page.getByRole("heading", { level: 1, name: "Stats" })
  ).toBeVisible();
  await expect(page.getByText(UNAVAILABLE_PATTERN).first()).toBeVisible();
  // A failing upstream must not reach the error boundary.
  await expect(page.getByText("Audit interrupted")).toHaveCount(0);
});

for (const viewport of VIEWPORTS) {
  test(`fits the ${viewport.label} viewport without horizontal overflow`, async ({
    next,
    page,
  }) => {
    next.onFetch(createNpmHandler());
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });

    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: "Stats" })
    ).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );

    expect(overflow).toBeLessThanOrEqual(0);
  });
}
