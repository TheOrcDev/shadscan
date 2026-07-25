import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { errorStateRetryPresentRule } from "../src/rules/error-state-retry-present";
import { highConfidenceRules } from "../src/rules/high-confidence";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { routeLoadingBoundaryPresentRule } from "../src/rules/route-loading-boundary-present";
import { themeHydrationSafeRule } from "../src/rules/theme-hydration-safe";
import { themeProviderMountedInShellRule } from "../src/rules/theme-provider-mounted-in-shell";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-rr-"));
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

const writeReactRouterProject = async (
  rootDir: string,
  extraDependencies: Record<string, string> = {}
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          react: "19.2.4",
          "react-router": "7.9.1",
          ...extraDependencies,
        },
        devDependencies: { "@react-router/dev": "7.9.1" },
        name: "react-router-fixture",
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    rootDir,
    "react-router.config.ts",
    "export default { ssr: true };\n"
  );
};

const ROOT_FULL = `import { isRouteErrorResponse, Links, Meta, Outlet, Scripts } from "react-router";

export function meta() {
  return [
    { title: "Router Fixture" },
    { content: "A React Router fixture for shadscan.", name: "description" },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider attribute="class">{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  if (isRouteErrorResponse(error)) {
    return <p>Not found.</p>;
  }
  return <p>Something went wrong.</p>;
}
`;

const ROOT_BARE = `import { Outlet } from "react-router";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
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

describe("react router framework rule branches", () => {
  it("reads document basics from the root module", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir, { "next-themes": "0.4.6" });
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_FULL);

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
        highConfidenceRules,
        "metadata-configured"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [themeProviderMountedInShellRule],
        "theme-provider-mounted-in-shell"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [themeHydrationSafeRule],
        "theme-hydration-safe"
      )
    ).toBe("pass");
  });

  it("fails document basics when the root module lacks them", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir, { "next-themes": "0.4.6" });
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);

    expect(
      await getFindingStatus(
        rootDir,
        [htmlLangPresentRule],
        "html-lang-present"
      )
    ).toBe("fail");
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
        [themeHydrationSafeRule],
        "theme-hydration-safe"
      )
    ).toBe("fail");
  });

  it("accepts an ErrorBoundary that handles route error responses", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_FULL);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "error-boundary-present"
      )
    ).toBe("pass");
  });

  it("accepts a splat route for not-found coverage", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);
    await writeFixtureFile(
      rootDir,
      "app/routes/$.tsx",
      "export default function CatchAll() { return <p>Not found.</p>; }\n"
    );

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("pass");
  });

  it("fails not-found and error coverage when neither exists", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("fail");
    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "error-boundary-present"
      )
    ).toBe("fail");
  });

  it("requires pending coverage only for loader-backed route modules", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);
    await writeFixtureFile(
      rootDir,
      "app/routes/home.tsx",
      `export async function loader() {
  return { items: [] };
}

export default function Home() {
  return <main>Home</main>;
}
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
      "app/routes/home.tsx",
      `export async function loader() {
  return { items: [] };
}

export function HydrateFallback() {
  return <output aria-busy="true">Loading…</output>;
}

export default function Home() {
  return <main>Home</main>;
}
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
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);
    await writeFixtureFile(
      rootDir,
      "app/routes/about.tsx",
      "export default function About() { return <main>About</main>; }\n"
    );

    expect(
      await getFindingStatus(
        rootDir,
        [routeLoadingBoundaryPresentRule],
        "route-loading-boundary-present"
      )
    ).toBe("not-applicable");
  });

  it("accepts useNavigation pending UI as loading coverage", async () => {
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_BARE);
    await writeFixtureFile(
      rootDir,
      "app/routes/home.tsx",
      "export async function loader() { return {}; }\nexport default function Home() { return <main />; }\n"
    );
    await writeFixtureFile(
      rootDir,
      "app/components/progress.tsx",
      `import { useNavigation } from "react-router";

export function Progress() {
  const navigation = useNavigation();
  return navigation.state === "loading" ? <div aria-busy="true" /> : null;
}
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

  it("does not let the shared app directory trigger Next-only checks", async () => {
    // React Router keeps its code in app/, the same name Next's App Router
    // uses. error-state-retry-present is a `core` rule that globs
    // app/**/error.tsx, so this pins that a React Router project is never
    // judged by Next's file conventions.
    const rootDir = await createFixture();
    await writeReactRouterProject(rootDir);
    await writeFixtureFile(rootDir, "app/root.tsx", ROOT_FULL);
    await writeFixtureFile(
      rootDir,
      "app/routes/home.tsx",
      "export default function Home() { return <main>Home</main>; }\n"
    );

    const report = await runAudit(rootDir, {
      rules: [errorStateRetryPresentRule],
    });
    const finding = report.findings.find(
      (candidate) => candidate.id === "error-state-retry-present"
    );

    expect(report.framework.adapter).toBe("react-router-framework");
    // No Next-style app/error.tsx exists, so the rule must report the honest
    // "nothing to check" outcome rather than a fabricated failure.
    expect(finding?.status).toBe("not-applicable");
  });
});
