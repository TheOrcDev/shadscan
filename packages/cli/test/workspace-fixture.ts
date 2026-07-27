import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type WorkspaceFixtureKind = "lerna" | "npm" | "none" | "nx" | "pnpm" | "turbo";

interface WorkspaceFixturePackage {
  /** Extra files, keyed by package-relative path. */
  files?: Record<string, string>;
  /** Merged into the generated package.json. */
  packageJson?: Record<string, unknown>;
  /** Package-relative directory; "." places the package at the root. */
  path: string;
  /**
   * Shorthand layouts. `next` and `vite` produce application shells,
   * `library` produces a package entry with no application entry, and
   * `none` writes only what `files` and `packageJson` specify.
   */
  preset?: "library" | "next" | "none" | "vite";
}

interface WorkspaceFixtureOptions {
  kind?: WorkspaceFixtureKind;
  packages: WorkspaceFixturePackage[];
  /** Merged into the generated root package.json. */
  rootPackageJson?: Record<string, unknown>;
}

const REACT_DEPENDENCIES = { react: "19.2.4", "react-dom": "19.2.4" };
const tempDirs: string[] = [];

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

const COMPONENTS_JSON = `${JSON.stringify(
  {
    aliases: { components: "@/components", ui: "@/components/ui" },
    style: "new-york",
  },
  null,
  2
)}\n`;

const NEXT_LAYOUT = `export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const NEXT_PAGE = `export default function Page() {
  return (
    <main>
      <h1>Page</h1>
    </main>
  );
}
`;

const VITE_APP = `export default function App() {
  return (
    <main>
      <h1>App</h1>
    </main>
  );
}
`;

const VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const LIBRARY_COMPONENT = `export function Button({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}
`;

const getPresetFiles = (
  preset: WorkspaceFixturePackage["preset"]
): Record<string, string> => {
  if (preset === "next") {
    return {
      "app/layout.tsx": NEXT_LAYOUT,
      "app/page.tsx": NEXT_PAGE,
      "components.json": COMPONENTS_JSON,
    };
  }

  if (preset === "vite") {
    return {
      "components.json": COMPONENTS_JSON,
      "index.html": VITE_INDEX_HTML,
      "src/App.tsx": VITE_APP,
    };
  }

  if (preset === "library") {
    return { "src/button.tsx": LIBRARY_COMPONENT };
  }

  return {};
};

const getPresetPackageJson = (
  preset: WorkspaceFixturePackage["preset"]
): Record<string, unknown> => {
  if (preset === "next") {
    return { dependencies: { next: "16.2.10", ...REACT_DEPENDENCIES } };
  }

  if (preset === "vite") {
    return {
      dependencies: REACT_DEPENDENCIES,
      devDependencies: { vite: "7.2.0" },
    };
  }

  if (preset === "library") {
    return { dependencies: { react: "19.2.4" }, main: "./src/button.tsx" };
  }

  return {};
};

const writeWorkspaceMarker = async (
  rootDir: string,
  kind: WorkspaceFixtureKind,
  packages: WorkspaceFixturePackage[]
): Promise<Record<string, unknown>> => {
  if (kind === "pnpm") {
    const entries = packages
      .filter((entry) => entry.path !== ".")
      .map((entry) => `  - "${entry.path}"`)
      .join("\n");
    await writeFixtureFile(
      rootDir,
      "pnpm-workspace.yaml",
      `packages:\n${entries}\n`
    );
    return {};
  }

  if (kind === "turbo") {
    await writeFixtureFile(
      rootDir,
      "turbo.json",
      `${JSON.stringify({ tasks: { build: {} } }, null, 2)}\n`
    );
    return {};
  }

  if (kind === "nx") {
    await writeFixtureFile(
      rootDir,
      "nx.json",
      `${JSON.stringify({}, null, 2)}\n`
    );
    return {};
  }

  if (kind === "lerna") {
    await writeFixtureFile(
      rootDir,
      "lerna.json",
      `${JSON.stringify({ version: "0.0.0" }, null, 2)}\n`
    );
    return {};
  }

  if (kind === "npm") {
    return {
      workspaces: packages
        .filter((entry) => entry.path !== ".")
        .map((entry) => entry.path),
    };
  }

  return {};
};

/**
 * Builds a throwaway workspace on disk so tests can state a layout in a few
 * lines. Returns the absolute root; every fixture is removed by
 * `cleanupWorkspaceFixtures`.
 */
const createWorkspaceFixture = async ({
  kind = "pnpm",
  packages,
  rootPackageJson = {},
}: WorkspaceFixtureOptions): Promise<string> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shadscan-workspace-"));
  tempDirs.push(rootDir);

  const markerFields = await writeWorkspaceMarker(rootDir, kind, packages);
  const rootPackage = packages.find((entry) => entry.path === ".");

  if (!rootPackage) {
    await writeFixtureFile(
      rootDir,
      "package.json",
      `${JSON.stringify(
        {
          name: "workspace-root",
          private: true,
          ...markerFields,
          ...rootPackageJson,
        },
        null,
        2
      )}\n`
    );
  }

  for (const entry of packages) {
    const packageDir =
      entry.path === "." ? rootDir : path.join(rootDir, entry.path);
    const isRoot = entry.path === ".";
    const packageJson = {
      name: entry.path === "." ? "workspace-root" : path.basename(entry.path),
      ...(isRoot ? { private: true, ...markerFields, ...rootPackageJson } : {}),
      ...getPresetPackageJson(entry.preset),
      ...entry.packageJson,
    };

    await writeFixtureFile(
      packageDir,
      "package.json",
      `${JSON.stringify(packageJson, null, 2)}\n`
    );

    const files = { ...getPresetFiles(entry.preset), ...entry.files };
    for (const [filePath, content] of Object.entries(files)) {
      await writeFixtureFile(packageDir, filePath, content);
    }
  }

  return rootDir;
};

const cleanupWorkspaceFixtures = async (): Promise<void> => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
};

export type { WorkspaceFixtureKind, WorkspaceFixturePackage };
export { cleanupWorkspaceFixtures, createWorkspaceFixture };
