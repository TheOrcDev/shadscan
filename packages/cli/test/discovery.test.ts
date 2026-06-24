import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverProject } from "../src/discovery";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "headless-shadcn-"));
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
