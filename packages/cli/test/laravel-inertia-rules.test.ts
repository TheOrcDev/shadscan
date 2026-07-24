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

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-laravel-"));
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

const writeLaravelProject = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          "@inertiajs/react": "2.0.11",
          react: "19.2.4",
        },
        devDependencies: {
          "laravel-vite-plugin": "1.3.0",
          vite: "7.2.0",
        },
        name: "laravel-inertia-fixture",
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    rootDir,
    "composer.json",
    `${JSON.stringify({ require: { "laravel/framework": "^12.0" } }, null, 2)}\n`
  );
  await writeFixtureFile(rootDir, "artisan", "#!/usr/bin/env php\n");
  await writeFixtureFile(
    rootDir,
    "resources/js/pages/dashboard.tsx",
    "export default function Dashboard() { return <main><h1>Dashboard</h1></main>; }\n"
  );
};

const BLADE_ROOT_FULL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <title inertia>Fixture</title>
    <link rel="icon" href="/favicon.svg" />
    <meta property="og:image" content="https://example.com/og.png" />
    @inertiaHead
  </head>
  <body>@inertia</body>
</html>
`;

const BLADE_ROOT_BARE = `<!DOCTYPE html>
<html>
  <head>@inertiaHead</head>
  <body>@inertia</body>
</html>
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

describe("laravel inertia rule branches", () => {
  it("reads document basics from the blade root view", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/views/app.blade.php",
      BLADE_ROOT_FULL
    );

    expect(
      await getFindingStatus(
        rootDir,
        [htmlLangPresentRule],
        "html-lang-present"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(rootDir, highConfidenceRules, "favicon-present")
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [socialPreviewPresentRule],
        "social-preview-present"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "metadata-configured"
      )
    ).toBe("pass");
  });

  it("fails document basics when the blade root view lacks them", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/views/app.blade.php",
      BLADE_ROOT_BARE
    );

    expect(
      await getFindingStatus(
        rootDir,
        [htmlLangPresentRule],
        "html-lang-present"
      )
    ).toBe("fail");
    expect(
      await getFindingStatus(rootDir, highConfidenceRules, "favicon-present")
    ).toBe("fail");
    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "metadata-configured"
      )
    ).toBe("fail");
  });

  it("passes metadata rules from Inertia Head markup", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/views/app.blade.php",
      BLADE_ROOT_BARE
    );
    await writeFixtureFile(
      rootDir,
      "resources/js/pages/home.tsx",
      `import { Head } from "@inertiajs/react";

export default function Home() {
  return (
    <>
      <Head title="Home">
        <meta name="description" content="A Laravel Inertia fixture." />
      </Head>
      <main />
    </>
  );
}
`
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

  it("accepts an svg favicon in public (pingcrm regression)", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(rootDir, "public/favicon.svg", "<svg />\n");

    expect(
      await getFindingStatus(rootDir, highConfidenceRules, "favicon-present")
    ).toBe("pass");
  });

  it("finds not-found coverage from the blade error view", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/views/errors/404.blade.php",
      "<h1>Not found</h1>\n"
    );

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("pass");
  });

  it("fails not-found coverage without an error surface", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("fail");
  });

  it("treats default Inertia progress as loading coverage", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/js/app.tsx",
      `import { createInertiaApp } from "@inertiajs/react";

createInertiaApp({
  resolve: (name) => import(\`./pages/\${name}.tsx\`),
  setup({ el }) {},
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

  it("fails loading coverage when progress is disabled with no fallback", async () => {
    const rootDir = await createFixture();
    await writeLaravelProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/js/app.tsx",
      `import { createInertiaApp } from "@inertiajs/react";

createInertiaApp({
  progress: false,
  resolve: (name) => import(\`./pages/\${name}.tsx\`),
  setup({ el }) {},
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
      "resources/js/lib/progress.ts",
      `import { router } from "@inertiajs/react";

router.on("start", () => document.body.setAttribute("data-loading", "true"));
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
});
