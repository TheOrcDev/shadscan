import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { FetchHandlerResult } from "next/experimental/testmode/playwright.js";
import { test } from "next/experimental/testmode/playwright.js";

const REPOSITORY = "TheOrcDev/shadscan";
const REPOSITORY_URL = `https://api.github.com/repos/${REPOSITORY}`;
const CONTRIBUTORS_URL = `${REPOSITORY_URL}/contributors?per_page=100`;

const TOP_CONTRIBUTOR_LABEL = /TheOrcDev on GitHub, 128 commits/;
const SINGLE_COMMIT_LABEL = /grommash on GitHub, 1 commit$/;
const CONTRIBUTORS_PATH = /\/contributors$/;

const VIEWPORTS = [
  { height: 820, width: 320 },
  { height: 820, width: 375 },
  { height: 900, width: 768 },
  { height: 1000, width: 1440 },
] as const;

const CONTRIBUTORS = [
  {
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    contributions: 128,
    html_url: "https://github.com/TheOrcDev",
    login: "TheOrcDev",
    type: "User",
  },
  {
    avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
    contributions: 1,
    html_url: "https://github.com/grommash",
    login: "grommash",
    type: "User",
  },
  {
    avatar_url: "https://avatars.githubusercontent.com/u/3?v=4",
    contributions: 9,
    html_url: "https://github.com/dependabot",
    login: "dependabot",
    type: "Bot",
  },
] as const;

const createGitHubHandler =
  (contributorsResponse: () => FetchHandlerResult) =>
  (request: Request): FetchHandlerResult => {
    if (request.url === CONTRIBUTORS_URL) {
      return contributorsResponse();
    }

    if (request.url === REPOSITORY_URL) {
      return Response.json({ private: false, stargazers_count: 128 });
    }

    return "abort";
  };

test("lists every human contributor with their commit counts", async ({
  next,
  page,
}) => {
  next.onFetch(createGitHubHandler(() => Response.json(CONTRIBUTORS)));

  await page.goto("/contributors");

  await expect(
    page.getByRole("heading", { level: 1, name: "Contributors" })
  ).toBeVisible();

  const totals = page.getByRole("region", { name: "Contribution totals" });
  await expect(totals.getByText("2", { exact: true })).toBeVisible();
  await expect(totals.getByText("129", { exact: true })).toBeVisible();

  const list = page.getByRole("region", { name: "Contributor list" });
  const contributorLinks = list.getByRole("link");
  await expect(contributorLinks).toHaveCount(2);

  // Ranked by commits, and the bot account never renders.
  await expect(contributorLinks.first()).toHaveAttribute(
    "href",
    "https://github.com/TheOrcDev"
  );
  await expect(
    list.getByRole("link", { name: TOP_CONTRIBUTOR_LABEL })
  ).toBeVisible();
  await expect(
    list.getByRole("link", { name: SINGLE_COMMIT_LABEL })
  ).toBeVisible();
  await expect(list.getByText("dependabot")).toHaveCount(0);

  const contributeSection = page.getByRole("region", {
    name: "How to contribute",
  });
  await expect(
    contributeSection.getByRole("link", { name: "View the repository" })
  ).toHaveAttribute("href", `https://github.com/${REPOSITORY}`);
  await expect(
    contributeSection.getByRole("link", { name: "Browse open issues" })
  ).toHaveAttribute("href", `https://github.com/${REPOSITORY}/issues`);

  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
});

test("stays useful when GitHub cannot serve the contributor list", async ({
  next,
  page,
}) => {
  next.onFetch(createGitHubHandler(() => new Response(null, { status: 404 })));

  await page.goto("/contributors");

  await expect(
    page.getByRole("heading", { level: 1, name: "Contributors" })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Contribution totals" })
  ).toHaveCount(0);
  await expect(
    page.getByText("The contributor list is unavailable right now.")
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View the repository" })
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const severeViolations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical"
  );
  expect(severeViolations, JSON.stringify(severeViolations, null, 2)).toEqual(
    []
  );
});

test("links to the contributors page from the site footer", async ({
  next,
  page,
}) => {
  next.onFetch(createGitHubHandler(() => Response.json(CONTRIBUTORS)));

  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Secondary" })
    .getByRole("link", { name: "Contributors" })
    .click();

  await expect(page).toHaveURL(CONTRIBUTORS_PATH);
  await expect(
    page.getByRole("heading", { level: 1, name: "Contributors" })
  ).toBeVisible();
});

for (const viewport of VIEWPORTS) {
  test(`fits the contributors page at ${viewport.width}px`, async ({
    next,
    page,
  }) => {
    next.onFetch(createGitHubHandler(() => Response.json(CONTRIBUTORS)));

    await page.setViewportSize(viewport);
    await page.goto("/contributors");

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}
