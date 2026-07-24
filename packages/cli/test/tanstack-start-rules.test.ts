import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { highConfidenceRules } from "../src/rules/high-confidence";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "../src/rules/metadata-title-description-complete";
import { routeLoadingBoundaryPresentRule } from "../src/rules/route-loading-boundary-present";
import { socialPreviewPresentRule } from "../src/rules/social-preview-present";
import { themeHydrationSafeRule } from "../src/rules/theme-hydration-safe";
import { themeProviderMountedInShellRule } from "../src/rules/theme-provider-mounted-in-shell";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-tanstack-"));
  tempDirs.push(fixtureDir);

  return fixtureDir;
};

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

const writeStartPackage = async (
  rootDir: string,
  extraDependencies: Record<string, string> = {}
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          "@tanstack/react-router": "1.130.2",
          "@tanstack/react-start": "1.131.7",
          react: "19.2.4",
          ...extraDependencies,
        },
        name: "tanstack-start-fixture",
      },
      null,
      2
    )}\n`
  );
};

const ROOT_ROUTE_WITH_HEAD = `import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    links: [{ href: "/favicon.svg", rel: "icon" }],
    meta: [
      { title: "Fixture App" },
      { content: "A TanStack Start fixture for shadscan.", name: "description" },
      { content: "https://example.com/og.png", property: "og:image" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class">
          <Outlet />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
`;

const BARE_ROOT_ROUTE = `import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
});
`;

const getFindingStatus = async (
  rootDir: string,
  rules: Parameters<typeof runAudit>[1]["rules"],
  findingId: string
) => {
  const report = await runAudit(rootDir, { rules });
  return report.findings.find((finding) => finding.id === findingId)?.status;
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("tanstack start rule branches", () => {
  it("passes metadata rules when the root route configures head()", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      ROOT_ROUTE_WITH_HEAD
    );

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "metadata-configured"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [metadataTitleDescriptionCompleteRule],
        "metadata-title-description-complete"
      )
    ).toBe("pass");
  });

  it("fails metadata rules when no head() metadata exists", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "metadata-configured"
      )
    ).toBe("fail");
    expect(
      await getFindingStatus(
        rootDir,
        [metadataTitleDescriptionCompleteRule],
        "metadata-title-description-complete"
      )
    ).toBe("fail");
  });

  it("finds not-found coverage from a router default component", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);
    await writeFixtureFile(
      rootDir,
      "src/router.tsx",
      `import { createRouter } from "@tanstack/react-router";

export const router = createRouter({
  defaultNotFoundComponent: () => <p>Nothing here.</p>,
});
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("pass");
  });

  it("fails not-found coverage when no component is configured", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("fail");
  });

  it("passes the favicon rule from a head() links entry", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      ROOT_ROUTE_WITH_HEAD
    );

    expect(
      await getFindingStatus(rootDir, highConfidenceRules, "favicon-present")
    ).toBe("pass");
  });

  it("requires pending coverage only for loader-backed routes", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  loader: () => fetch("/api/things").then((response) => response.json()),
  component: () => <div>Things</div>,
});
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [routeLoadingBoundaryPresentRule],
        "route-loading-boundary-present"
      )
    ).toBe("fail");

    await writeFixtureFile(
      rootDir,
      "src/router.tsx",
      `import { createRouter } from "@tanstack/react-router";

export const router = createRouter({
  defaultPendingComponent: () => <p aria-busy="true">Loading…</p>,
});
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [routeLoadingBoundaryPresentRule],
        "route-loading-boundary-present"
      )
    ).toBe("pass");
  });

  it("treats loader-free route trees as not applicable for pending coverage", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <div>Static</div>,
});
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [routeLoadingBoundaryPresentRule],
        "route-loading-boundary-present"
      )
    ).toBe("not-applicable");
  });

  it("checks theme hydration safety in the root route shell", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir, { "next-themes": "0.4.6" });
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      ROOT_ROUTE_WITH_HEAD
    );

    expect(
      await getFindingStatus(
        rootDir,
        [themeHydrationSafeRule],
        "theme-hydration-safe"
      )
    ).toBe("pass");

    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);

    expect(
      await getFindingStatus(
        rootDir,
        [themeHydrationSafeRule],
        "theme-hydration-safe"
      )
    ).toBe("fail");
  });

  it("resolves document shell rules against the root route", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir, { "next-themes": "0.4.6" });
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      ROOT_ROUTE_WITH_HEAD
    );

    expect(
      await getFindingStatus(
        rootDir,
        [htmlLangPresentRule],
        "html-lang-present"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [themeProviderMountedInShellRule],
        "theme-provider-mounted-in-shell"
      )
    ).toBe("pass");
  });

  it("finds social preview metadata in head() meta entries", async () => {
    const rootDir = await createFixture();
    await writeStartPackage(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      ROOT_ROUTE_WITH_HEAD
    );

    expect(
      await getFindingStatus(
        rootDir,
        [socialPreviewPresentRule],
        "social-preview-present"
      )
    ).toBe("pass");

    await writeFixtureFile(rootDir, "src/routes/__root.tsx", BARE_ROOT_ROUTE);

    expect(
      await getFindingStatus(
        rootDir,
        [socialPreviewPresentRule],
        "social-preview-present"
      )
    ).toBe("fail");
  });
});
