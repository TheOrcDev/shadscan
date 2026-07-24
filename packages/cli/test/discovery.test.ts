import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery";

const BLADE_OR_LIVEWIRE_PATTERN = /Blade or Livewire/;
const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-"));
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

const writePackageJson = async (
  rootDir: string,
  packageJson: Record<string, unknown>
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(packageJson, null, 2)}\n`
  );
};

const writeComponentsJson = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "components.json",
    `${JSON.stringify(
      {
        aliases: {
          components: "@/components",
          ui: "@/components/ui",
          utils: "@/lib/utils",
        },
        style: "new-york",
        tailwind: {
          css: "app/globals.css",
        },
      },
      null,
      2
    )}\n`
  );
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("discoverProject", () => {
  it("detects a root Next App Router shadcn app", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        next: "16.2.6",
        react: "19.2.4",
      },
      name: "next-fixture",
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "app/page.tsx",
      "export default function Page() { return null }\n"
    );
    await writeFixtureFile(
      rootDir,
      "app/globals.css",
      "@import 'tailwindcss';\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("next-app-router");
    expect(project.packageName).toBe("next-fixture");
    expect(project.scripts).toEqual({});
    expect(project.shadcn.confidence).toBe("high");
    expect(project.shadcn.aliases.ui).toBe("@/components/ui");
    expect(project.paths.appDir).toBe(path.join(rootDir, "app"));
    expect(project.paths.tailwindCss).toBe(
      path.join(rootDir, "app/globals.css")
    );
  });

  it("detects a src/app Next App Router project", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        next: "16.2.6",
        react: "19.2.4",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app/page.tsx",
      "export default function Page() { return null }\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("next-app-router");
    expect(project.paths.appDir).toBe(path.join(rootDir, "src", "app"));
    expect(project.paths.srcDir).toBe(path.join(rootDir, "src"));
  });

  it("detects a Next Pages Router project", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        next: "16.2.6",
        react: "19.2.4",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "pages/index.tsx",
      "export default function Page() { return null }\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("next-pages-router");
    expect(project.paths.appDir).toBeNull();
    expect(project.paths.pagesDir).toBe(path.join(rootDir, "pages"));
  });

  it("detects a Next project that serves both router trees", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        next: "16.2.6",
        react: "19.2.4",
      },
    });
    await writeFixtureFile(
      rootDir,
      "app/page.tsx",
      "export default function AppPage() { return null }\n"
    );
    await writeFixtureFile(
      rootDir,
      "pages/legacy.tsx",
      "export default function LegacyPage() { return null }\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("next-hybrid-router");
    expect(project.framework.evidence).toEqual([
      "next dependency found",
      "app router directory found at app",
      "pages router directory found at pages",
    ]);
    expect(project.paths.appDir).toBe(path.join(rootDir, "app"));
    expect(project.paths.pagesDir).toBe(path.join(rootDir, "pages"));
  });

  it("detects a Vite React shadcn app", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@vitejs/plugin-react": "latest",
        react: "19.2.4",
        vite: "7.2.0",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "index.html", '<div id="root"></div>\n');
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css'\n");

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("vite-react");
    expect(project.paths.viteEntry).toBe(path.join(rootDir, "src", "main.tsx"));
    expect(project.versions.vite).toBe("7.2.0");
  });

  it("detects a Laravel Inertia React shadcn app", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@inertiajs/react": "2.0.11",
        react: "19.2.4",
      },
      devDependencies: {
        "laravel-vite-plugin": "1.3.0",
        vite: "7.2.0",
      },
    });
    await writeFixtureFile(
      rootDir,
      "composer.json",
      `${JSON.stringify({ require: { "laravel/framework": "^12.0" } }, null, 2)}\n`
    );
    await writeFixtureFile(rootDir, "artisan", "#!/usr/bin/env php\n");
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/js/pages/dashboard.tsx",
      "export default function Dashboard() { return <main />; }\n"
    );
    await writeFixtureFile(
      rootDir,
      "resources/views/app.blade.php",
      '<html lang="en"><head>@inertiaHead</head><body>@inertia</body></html>\n'
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("laravel-inertia-react");
    expect(project.framework.evidence).toContain(
      "inertia react dependency found"
    );
    expect(project.paths.inertiaPagesDir).toBe(
      path.join(rootDir, "resources", "js", "pages")
    );
    expect(project.paths.bladeRootView).toBe(
      path.join(rootDir, "resources", "views", "app.blade.php")
    );
    expect(project.versions.inertia).toBe("2.0.11");
    expect(project.versions.laravel).toBe("^12.0");
  });

  it("accepts the capitalized Inertia Pages directory", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@inertiajs/react": "2.0.11",
        react: "19.2.4",
      },
      devDependencies: { "laravel-vite-plugin": "1.3.0" },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "resources/js/Pages/Dashboard.tsx",
      "export default function Dashboard() { return <main />; }\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("laravel-inertia-react");
    // Case-insensitive filesystems (macOS) may report the lowercase probe;
    // case-sensitive systems return the real Pages casing. Both are valid.
    expect(project.paths.inertiaPagesDir?.toLowerCase()).toBe(
      path.join(rootDir, "resources", "js", "pages").toLowerCase()
    );
  });

  it("keeps non-laravel inertia hosts on the vite adapter with evidence", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@inertiajs/react": "2.0.11",
        react: "19.2.4",
        vite: "7.2.0",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css'\n");

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("vite-react");
    expect(project.framework.evidence).toContain(
      "inertia react dependency found without a laravel marker (artisan or laravel-vite-plugin); non-laravel inertia hosts use the vite or generic adapter"
    );
  });

  it("prefers laravel-inertia-react over vite-react when both signals exist", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@inertiajs/react": "2.0.11",
        react: "19.2.4",
        vite: "7.2.0",
      },
    });
    await writeFixtureFile(rootDir, "artisan", "#!/usr/bin/env php\n");
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css'\n");
    await writeFixtureFile(
      rootDir,
      "resources/js/pages/home.tsx",
      "export default function Home() { return <main />; }\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("laravel-inertia-react");
  });

  it("names the blade or livewire stack when a laravel app has no react", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      devDependencies: { "laravel-vite-plugin": "1.3.0" },
    });
    await writeFixtureFile(
      rootDir,
      "composer.json",
      `${JSON.stringify({ require: { "laravel/framework": "^12.0" } }, null, 2)}\n`
    );

    await expect(discoverProject(rootDir)).rejects.toThrow(
      BLADE_OR_LIVEWIRE_PATTERN
    );
  });

  it("detects a TanStack Start shadcn app", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@tanstack/react-router": "1.130.2",
        "@tanstack/react-start": "1.131.7",
        react: "19.2.4",
      },
      devDependencies: {
        vite: "7.2.0",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/__root.tsx",
      "export const Route = createRootRoute({});\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("tanstack-start");
    expect(project.framework.evidence).toContain(
      "tanstack start dependency found"
    );
    expect(project.paths.routesDir).toBe(path.join(rootDir, "src", "routes"));
    expect(project.versions.tanstackStart).toBe("1.131.7");
  });

  it("prefers tanstack-start over vite-react when both signals exist", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@tanstack/react-start": "1.131.7",
        react: "19.2.4",
        vite: "7.2.0",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css'\n");
    await writeFixtureFile(
      rootDir,
      "app/routes/__root.tsx",
      "export const Route = createRootRoute({});\n"
    );

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("tanstack-start");
    expect(project.paths.routesDir).toBe(path.join(rootDir, "app", "routes"));
  });

  it("keeps a router-only tanstack app on the vite adapter with evidence", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@tanstack/react-router": "1.130.2",
        react: "19.2.4",
        vite: "7.2.0",
      },
    });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css'\n");

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("vite-react");
    expect(project.framework.evidence).toContain(
      "tanstack router dependency found; router-only projects use the vite or generic adapter"
    );
  });

  it("falls through with evidence when the start dependency has no routes directory", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        "@tanstack/react-start": "1.131.7",
        react: "19.2.4",
      },
    });
    await writeComponentsJson(rootDir);

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("generic-react");
    expect(project.framework.evidence).toContain(
      "tanstack start dependency found but no routes directory (src/routes or app/routes) exists"
    );
  });

  it("discovers the package manager and selected app from a bounded monorepo", async () => {
    const sourceRoot = await createFixture();
    const projectRoot = path.join(sourceRoot, "apps", "web");
    await writePackageJson(sourceRoot, {
      packageManager: "pnpm@11.15.1",
      private: true,
    });
    await writePackageJson(projectRoot, {
      dependencies: { react: "19.2.4" },
      name: "web-app",
    });

    const project = await discoverProject(projectRoot, {
      filesystemRoot: sourceRoot,
    });

    expect(project.packageManager).toBe("pnpm");
    expect(project.packageManagerRoot).toBe(sourceRoot);
    expect(project.selectedProjectPath).toBe("apps/web");
  });

  it("recognizes the current Bun lockfile", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: { react: "19.2.4" },
    });
    await writeFixtureFile(rootDir, "bun.lock", "");

    const project = await discoverProject(rootDir);

    expect(project.packageManager).toBe("bun");
    expect(project.selectedProjectPath).toBe(".");
  });

  it("falls back to generic React when no framework-specific adapter matches", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        react: "19.2.4",
      },
    });
    await writeComponentsJson(rootDir);

    const project = await discoverProject(rootDir);

    expect(project.framework.adapter).toBe("generic-react");
    expect(project.framework.evidence).toContain("react dependency found");
  });

  it("rejects packages that do not declare React", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        express: "5.1.0",
      },
    });

    await expect(discoverProject(rootDir)).rejects.toMatchObject({
      code: "UNSUPPORTED_PROJECT",
      name: "ProjectDiscoveryError",
    });
  });

  it("continues with low confidence when components.json is missing", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        react: "19.2.4",
      },
    });

    const project = await discoverProject(rootDir);

    expect(project.shadcn.configPath).toBeNull();
    expect(project.shadcn.confidence).toBe("low");
    expect(project.warnings).toContain(
      "components.json was not found; shadcn detection confidence is low."
    );
  });

  it("warns when components.json cannot be parsed", async () => {
    const rootDir = await createFixture();
    await writePackageJson(rootDir, {
      dependencies: {
        react: "19.2.4",
      },
    });
    await writeFixtureFile(rootDir, "components.json", "{ not-json }\n");

    const project = await discoverProject(rootDir);

    expect(project.shadcn.configPath).toBeNull();
    expect(project.shadcn.confidence).toBe("low");
    expect(project.warnings).toContain(
      "components.json exists but could not be parsed."
    );
  });
});
