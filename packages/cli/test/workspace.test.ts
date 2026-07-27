import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkspace } from "../src/workspace";
import {
  cleanupWorkspaceFixtures,
  createWorkspaceFixture,
  type WorkspaceFixtureKind,
} from "./workspace-fixture";

const PACKAGE_ENTRY_REASON_PATTERN = /no application entry point/;
const NO_REACT_PATTERN = /does not declare React/;

const getProject = (
  projects: Awaited<ReturnType<typeof discoverWorkspace>>["projects"],
  packageDir: string
) => projects.find((project) => project.packageDir === packageDir);

afterEach(async () => {
  await cleanupWorkspaceFixtures();
});

describe("workspace discovery", () => {
  it("enumerates every auditable package in deterministic order", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const workspace = await discoverWorkspace(rootDir);

    expect(workspace.kind).toBe("pnpm");
    expect(workspace.projects.map((project) => project.packageDir)).toEqual([
      "apps/admin",
      "apps/web",
      "packages/ui",
    ]);
  });

  it("classifies applications, libraries, and the reason for each", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const { projects } = await discoverWorkspace(rootDir);

    expect(getProject(projects, "apps/web")?.kind).toBe("application");
    expect(getProject(projects, "apps/web")?.adapter).toBe("next-app-router");
    expect(getProject(projects, "apps/admin")?.kind).toBe("application");
    expect(getProject(projects, "packages/ui")?.kind).toBe("library");
    expect(getProject(projects, "packages/ui")?.kindReason).toMatch(
      PACKAGE_ENTRY_REASON_PATTERN
    );
  });

  it("classifies a generic React package by its application entry point", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        {
          files: { "src/main.tsx": "export const main = () => null;\n" },
          packageJson: { dependencies: { react: "19.2.4" } },
          path: "apps/spa",
          preset: "none",
        },
      ],
    });
    const withEntry = await createWorkspaceFixture({
      packages: [
        {
          files: {
            "index.html":
              '<!doctype html>\n<html lang="en"><body></body></html>\n',
            "src/main.tsx": "export const main = () => null;\n",
          },
          packageJson: { dependencies: { react: "19.2.4" } },
          path: "apps/spa",
          preset: "none",
        },
      ],
    });

    const bare = await discoverWorkspace(rootDir);
    const entry = await discoverWorkspace(withEntry);

    expect(getProject(bare.projects, "apps/spa")?.kind).toBe("library");
    expect(getProject(entry.projects, "apps/spa")?.kind).toBe("application");
  });

  it("skips packages that shadscan cannot audit instead of failing", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        {
          files: { "src/index.ts": "export const noop = () => {};\n" },
          path: "packages/utils",
          preset: "none",
        },
      ],
    });

    const workspace = await discoverWorkspace(rootDir);

    expect(workspace.projects.map((project) => project.packageDir)).toEqual([
      "apps/web",
    ]);
    expect(workspace.skipped).toContainEqual({
      packageDir: "packages/utils",
      reason: expect.stringMatching(NO_REACT_PATTERN),
    });
  });

  it("survives a malformed package manifest", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [{ path: "apps/web", preset: "next" }],
    });
    await createWorkspaceFixture({ packages: [] });
    const broken = path.join(rootDir, "packages/broken");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, "package.json"), "{ not json");

    const workspace = await discoverWorkspace(rootDir);

    expect(workspace.projects.map((project) => project.packageDir)).toEqual([
      "apps/web",
    ]);
    expect(
      workspace.skipped.some((skip) => skip.packageDir === "packages/broken")
    ).toBe(true);
  });

  it("includes a root package alongside its workspace packages exactly once", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: ".", preset: "next" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const workspace = await discoverWorkspace(rootDir);

    expect(workspace.projects.map((project) => project.packageDir)).toEqual([
      ".",
      "packages/ui",
    ]);
    expect(getProject(workspace.projects, ".")?.kind).toBe("application");
  });

  it("does not double-count packages in a nested workspace", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "nested/packages/ui", preset: "library" },
      ],
    });
    const { writeFile } = await import("node:fs/promises");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(rootDir, "nested"), { recursive: true });
    await writeFile(
      path.join(rootDir, "nested/package.json"),
      '{ "name": "nested", "private": true, "workspaces": ["packages/*"] }\n'
    );
    await writeFile(
      path.join(rootDir, "nested/pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n'
    );

    const workspace = await discoverWorkspace(rootDir);
    const dirs = workspace.projects.map((project) => project.packageDir);

    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs).toContain("nested/packages/ui");
  });

  it("reports workspace-relative paths with posix separators", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [{ path: "apps/web", preset: "next" }],
    });

    const workspace = await discoverWorkspace(rootDir);

    for (const project of workspace.projects) {
      expect(project.packageDir).not.toContain("\\");
    }
  });

  it.each<[WorkspaceFixtureKind, string]>([
    ["pnpm", "pnpm"],
    ["npm", "npm"],
    ["turbo", "turbo"],
    ["nx", "nx"],
    ["lerna", "lerna"],
    ["none", "none"],
  ])("detects a %s workspace", async (kind, expected) => {
    const rootDir = await createWorkspaceFixture({
      kind,
      packages: [{ path: "apps/web", preset: "next" }],
    });

    const workspace = await discoverWorkspace(rootDir);

    expect(workspace.kind).toBe(expected);
  });

  it("returns an identical result when run twice", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const first = await discoverWorkspace(rootDir);
    const second = await discoverWorkspace(rootDir);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
