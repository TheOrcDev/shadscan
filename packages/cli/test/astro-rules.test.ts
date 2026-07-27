import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { highConfidenceRules } from "../src/rules/high-confidence";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "../src/rules/metadata-title-description-complete";
import { socialPreviewPresentRule } from "../src/rules/social-preview-present";
import { themeProviderMountedInShellRule } from "../src/rules/theme-provider-mounted-in-shell";
import { toastProviderMountedRule } from "../src/rules/toast-provider-mounted";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-astro-"));
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

const writeAstroProject = async (
  rootDir: string,
  extraDependencies: Record<string, string> = {}
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          "@astrojs/react": "4.4.0",
          astro: "5.16.2",
          react: "19.2.4",
          ...extraDependencies,
        },
        name: "astro-fixture",
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    rootDir,
    "src/pages/index.astro",
    `---
import Layout from "../layouts/Layout.astro";
---
<Layout>
  <p>hello</p>
</Layout>
`
  );
};

const LAYOUT_FULL = `---
---
<html lang="en">
  <head>
    <title>Astro Fixture</title>
    <meta name="description" content="An Astro fixture for shadscan." />
    <meta property="og:image" content="https://example.com/og.png" />
    <link rel="icon" href="/favicon.svg" />
  </head>
  <body>
    <slot />
  </body>
</html>
`;

const LAYOUT_BARE = `---
---
<html>
  <head></head>
  <body>
    <slot />
  </body>
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

describe("astro rule branches", () => {
  it("reads document basics from the astro layout shell", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);
    await writeFixtureFile(rootDir, "src/layouts/Layout.astro", LAYOUT_FULL);

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
    expect(
      await getFindingStatus(
        rootDir,
        [metadataTitleDescriptionCompleteRule],
        "metadata-title-description-complete"
      )
    ).toBe("pass");
  });

  it("fails document basics when the shell lacks them", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);
    await writeFixtureFile(rootDir, "src/layouts/Layout.astro", LAYOUT_BARE);

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

  it("finds not-found coverage from the astro 404 page", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/pages/404.astro",
      "---\n---\n<h1>Not found</h1>\n"
    );

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("pass");
  });

  it("fails not-found coverage without a 404 page", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);

    expect(
      await getFindingStatus(
        rootDir,
        highConfidenceRules,
        "not-found-route-present"
      )
    ).toBe("fail");
  });

  it("sees a theme provider island mounted in the shell", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/layouts/Layout.astro",
      `---
import { ThemeProvider } from "@/components/theme-provider";
---
<html lang="en">
  <body>
    <ThemeProvider client:load>
      <slot />
    </ThemeProvider>
  </body>
</html>
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [themeProviderMountedInShellRule],
        "theme-provider-mounted-in-shell"
      )
    ).toBe("pass");

    await writeFixtureFile(rootDir, "src/layouts/Layout.astro", LAYOUT_BARE);

    expect(
      await getFindingStatus(
        rootDir,
        [themeProviderMountedInShellRule],
        "theme-provider-mounted-in-shell"
      )
    ).toBe("fail");
  });

  it("accepts expression-valued meta content (astro-nomy regression)", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/layouts/Layout.astro",
      `---
const { title, description, ogImage } = Astro.props;
---
<html lang="en">
  <head>
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta property="og:image" content={ogImage} />
  </head>
  <body><slot /></body>
</html>
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [metadataTitleDescriptionCompleteRule],
        "metadata-title-description-complete"
      )
    ).toBe("pass");
    expect(
      await getFindingStatus(
        rootDir,
        [socialPreviewPresentRule],
        "social-preview-present"
      )
    ).toBe("pass");
  });

  it("treats a package-direct toaster island as mounted (astro-nomy regression)", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir, { sonner: "2.0.0" });
    await writeFixtureFile(
      rootDir,
      "src/layouts/Layout.astro",
      `---
import { Toaster } from "sonner";
---
<html lang="en">
  <body>
    <slot />
    <Toaster richColors client:only="react" />
  </body>
</html>
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [toastProviderMountedRule],
        "toast-provider-mounted"
      )
    ).toBe("pass");
  });

  it("traces a toaster island from the shell to its runtime", async () => {
    const rootDir = await createFixture();
    await writeAstroProject(rootDir, { sonner: "2.0.0" });
    await writeFixtureFile(
      rootDir,
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            jsx: "react-jsx",
            paths: { "@/*": ["./src/*"] },
          },
        },
        null,
        2
      )}\n`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/ui/sonner.tsx",
      `import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return <Sonner richColors />;
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/layouts/Layout.astro",
      `---
import { Toaster } from "@/components/ui/sonner";
---
<html lang="en">
  <body>
    <slot />
    <Toaster client:load />
  </body>
</html>
`
    );

    expect(
      await getFindingStatus(
        rootDir,
        [toastProviderMountedRule],
        "toast-provider-mounted"
      )
    ).toBe("pass");
  });
});
