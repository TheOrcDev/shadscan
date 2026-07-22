import { expect, test } from "@playwright/test";

const SITE_ORIGIN = "http://localhost:3210";
const INDEX_FOLLOW_PATTERN = /index, follow/;
const NOREFERRER_REL_PATTERN = /noreferrer/;

const PAGE_METADATA = [
  {
    browserTitle: "shadscan: Audit shadcn apps for UI fundamentals",
    description:
      "Audit accessibility, UI states, navigation, forms, metadata, and production polish with deterministic evidence and agent-ready fixes.",
    imagePath: "/opengraph-image",
    path: "/",
    socialTitle: "shadscan: Audit shadcn apps for UI fundamentals",
  },
  {
    browserTitle: "Scan a shadcn app | shadscan",
    description:
      "Paste a public GitHub repository to get a deterministic Shadscan score, cited evidence, and actionable fixes.",
    imagePath: "/scan/opengraph-image",
    path: "/scan",
    socialTitle: "Scan a shadcn app | shadscan",
  },
  {
    browserTitle: "Shadscan CLI documentation | shadscan",
    description:
      "Run Shadscan, inspect a progress-bar score, launch a coding agent, enforce score thresholds, and add a safe pre-commit gate.",
    imagePath: "/docs/opengraph-image",
    path: "/docs",
    socialTitle: "Shadscan CLI documentation | shadscan",
  },
  {
    browserTitle: "Sponsor shadscan | shadscan",
    description:
      "Support deterministic, open-source UI auditing for React and shadcn applications.",
    imagePath: "/sponsors/opengraph-image",
    path: "/sponsors",
    socialTitle: "Sponsor shadscan | shadscan",
  },
  {
    browserTitle: "Privacy Policy | shadscan",
    description:
      "How Shadscan processes repository scans, request data, local preferences, and communications.",
    imagePath: "/opengraph-image",
    path: "/privacy",
    socialTitle: "Privacy Policy | shadscan",
  },
  {
    browserTitle: "Terms of Service | shadscan",
    description:
      "Terms governing use of the Shadscan website, CLI, hosted scanner, and API.",
    imagePath: "/opengraph-image",
    path: "/terms",
    socialTitle: "Terms of Service | shadscan",
  },
] as const;

const expectAbsolutePath = (value: string | null, path: string): void => {
  expect(value).not.toBeNull();
  const url = new URL(value ?? "", SITE_ORIGIN);
  expect(url.origin).toBe(SITE_ORIGIN);
  expect(url.pathname).toBe(path);
};

for (const pageMetadata of PAGE_METADATA) {
  test(`renders complete metadata for ${pageMetadata.path}`, async ({
    page,
  }) => {
    await page.goto(pageMetadata.path);

    await expect(page).toHaveTitle(pageMetadata.browserTitle);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      pageMetadata.description
    );

    expectAbsolutePath(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      pageMetadata.path
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      pageMetadata.socialTitle
    );
    await expect(
      page.locator('meta[property="og:description"]')
    ).toHaveAttribute("content", pageMetadata.description);
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "shadscan"
    );
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      "en_US"
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "website"
    );
    expectAbsolutePath(
      await page.locator('meta[property="og:url"]').getAttribute("content"),
      pageMetadata.path
    );
    expectAbsolutePath(
      await page.locator('meta[property="og:image"]').getAttribute("content"),
      pageMetadata.imagePath
    );

    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image"
    );
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      pageMetadata.socialTitle
    );
    await expect(
      page.locator('meta[name="twitter:description"]')
    ).toHaveAttribute("content", pageMetadata.description);
    expectAbsolutePath(
      await page.locator('meta[name="twitter:image"]').getAttribute("content"),
      pageMetadata.imagePath
    );
  });
}

test("publishes app identity and structured data", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest"
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute(
    "content",
    "shadscan"
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    INDEX_FOLLOW_PATTERN
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);

  const structuredDataText = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  const structuredData = JSON.parse(structuredDataText ?? "null") as {
    "@context": string;
    "@graph": Record<string, unknown>[];
  };
  expect(structuredData["@context"]).toBe("https://schema.org");
  expect(structuredData["@graph"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ "@type": "Organization", name: "OrcDev" }),
      expect.objectContaining({ "@type": "WebSite", name: "shadscan" }),
      expect.objectContaining({
        "@type": "SoftwareApplication",
        isAccessibleForFree: true,
        name: "shadscan",
      }),
    ])
  );
  const softwareApplication = structuredData["@graph"].find(
    (entry) => entry["@type"] === "SoftwareApplication"
  );
  expect(softwareApplication?.sameAs).toEqual([
    "https://www.npmjs.com/package/@shadscan/cli",
  ]);
  const githubLink = page.locator(
    'a[href="https://github.com/TheOrcDev/shadscan"]'
  );
  // Hero CTA + header GitHub stars both point at the source repository.
  await expect(githubLink).toHaveCount(2);
  await expect(githubLink.first()).toHaveAttribute("target", "_blank");
  await expect(githubLink.first()).toHaveAttribute(
    "rel",
    NOREFERRER_REL_PATTERN
  );
});

test("serves a complete web app manifest and install icons", async ({
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain(
    "application/manifest+json"
  );

  const manifest = (await manifestResponse.json()) as {
    display: string;
    icons: Array<{ purpose?: string; sizes: string; src: string }>;
    name: string;
    start_url: string;
  };
  expect(manifest).toMatchObject({
    display: "standalone",
    name: "shadscan",
    start_url: "/",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        purpose: "any",
        sizes: "192x192",
        src: "/icons/shadscan-192.png",
      }),
      expect.objectContaining({
        purpose: "maskable",
        sizes: "512x512",
        src: "/icons/shadscan-maskable-512.png",
      }),
    ])
  );

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
});

test("publishes crawl controls and only public pages in the sitemap", async ({
  request,
}) => {
  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);
  const robots = await robotsResponse.text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain(`${SITE_ORIGIN}/sitemap.xml`);

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  const sitemap = await sitemapResponse.text();
  for (const { path } of PAGE_METADATA) {
    expect(sitemap).toContain(new URL(path, SITE_ORIGIN).href);
  }
  expect(sitemap).not.toContain("/api/");
  expect(sitemap).not.toContain("/v1/");
});

for (const imagePath of [
  "/opengraph-image",
  "/scan/opengraph-image",
  "/docs/opengraph-image",
  "/sponsors/opengraph-image",
]) {
  test(`renders the 1200x630 social card at ${imagePath}`, async ({
    request,
  }) => {
    const response = await request.get(imagePath);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");

    const image = await response.body();
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
  });
}
