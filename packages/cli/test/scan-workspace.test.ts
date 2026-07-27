import { afterEach, describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/scan-workspace";
import {
  cleanupWorkspaceFixtures,
  createWorkspaceFixture,
} from "./workspace-fixture";

const APP_EVIDENCE_PATH_PATTERN = /^apps\/(admin|web)\//;

const getProject = (
  report: Awaited<ReturnType<typeof scanWorkspace>>,
  packageDir: string
) =>
  report.workspace?.projects.find((entry) => entry.packageDir === packageDir);

afterEach(async () => {
  await cleanupWorkspaceFixtures();
});

describe("workspace scanning", () => {
  it("pools every application into one score and reports each package", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });

    const report = await scanWorkspace(rootDir);

    expect(report.schemaVersion).toBe(9);
    expect(report.workspace?.applicationCount).toBe(2);
    expect(report.score).not.toBeNull();
    expect(getProject(report, "apps/web")?.score).not.toBeNull();
    expect(getProject(report, "apps/admin")?.score).not.toBeNull();
  });

  it("reports a mixed adapter only when applications disagree", async () => {
    const mixedRoot = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });
    const sameRoot = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/docs", preset: "next" },
      ],
    });

    const mixed = await scanWorkspace(mixedRoot);
    const same = await scanWorkspace(sameRoot);

    expect(mixed.framework.adapter).toBe("mixed");
    expect(same.framework.adapter).toBe("next-app-router");
  });

  it("keeps library findings visible but out of the score", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const report = await scanWorkspace(rootDir);
    const libraryFindings = report.findings.filter(
      (finding) => finding.packageDir === "packages/ui"
    );

    expect(libraryFindings.length).toBeGreaterThan(0);
    expect(
      libraryFindings.every((finding) => finding.impactsScore === false)
    ).toBe(true);
    expect(getProject(report, "packages/ui")?.poolsIntoScore).toBe(false);
    expect(getProject(report, "packages/ui")?.score).not.toBeNull();
  });

  it("scores an app-at-root workspace identically to the app alone", async () => {
    const withLibrary = await createWorkspaceFixture({
      packages: [
        { path: ".", preset: "next" },
        { path: "packages/ui", preset: "library" },
        { path: "packages/icons", preset: "library" },
      ],
    });
    const appOnly = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });

    const pooled = await scanWorkspace(withLibrary);
    const alone = await scanWorkspace(appOnly);

    /**
     * Compare every category, not just the total. A library contributes both
     * weak categories (no document shell) and strong ones (its components are
     * accessible), which can cancel out in the total and hide a regression.
     */
    expect(pooled.categories).toEqual(alone.categories);
    expect(pooled.score).toBe(alone.score);
  });

  it("tags every finding with the package it came from", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });

    const report = await scanWorkspace(rootDir);
    const packageDirs = new Set(
      report.findings.map((finding) => finding.packageDir)
    );

    expect(packageDirs).toEqual(new Set(["apps/admin", "apps/web"]));
  });

  it("prefixes evidence paths so two packages stay distinguishable", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });

    const report = await scanWorkspace(rootDir);
    const paths = report.findings.flatMap((finding) =>
      finding.evidence.map((item) => item.filePath).filter(Boolean)
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const filePath of paths) {
      expect(filePath).toMatch(APP_EVIDENCE_PATH_PATTERN);
    }
  });

  it("records skipped packages without failing the run", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
        {
          files: { "src/index.ts": "export const noop = () => {};\n" },
          path: "packages/utils",
          preset: "none",
        },
      ],
    });

    const report = await scanWorkspace(rootDir);

    expect(report.score).not.toBeNull();
    expect(
      report.workspace?.skipped.some(
        (skip) => skip.packageDir === "packages/utils"
      )
    ).toBe(true);
  });

  it("produces an identical report when run twice", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
        { path: "packages/ui", preset: "library" },
      ],
    });

    const first = await scanWorkspace(rootDir);
    const second = await scanWorkspace(rootDir);

    expect(JSON.stringify({ ...second, durationMs: 0 })).toBe(
      JSON.stringify({ ...first, durationMs: 0 })
    );
  });
});
