import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaterializedScanSource } from "../../lib/shadscan-api/contracts";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import { runHostedScan } from "../../lib/shadscan-api/run-hosted-scan";

const SOURCE_DIGEST = `sha256:${"a".repeat(64)}`;
const cleanupDirectories = new Set<string>();

const createMaterializedSource = async (
  sourceText: string
): Promise<MaterializedScanSource> => {
  const sourceRoot = await mkdtemp(
    path.join(tmpdir(), "shadscan-worker-test-")
  );
  cleanupDirectories.add(sourceRoot);
  await mkdir(path.join(sourceRoot, "src"));
  await Promise.all([
    writeFile(
      path.join(sourceRoot, "package.json"),
      `${JSON.stringify({
        dependencies: { react: "19.2.4" },
        name: "worker-fixture",
      })}\n`
    ),
    writeFile(path.join(sourceRoot, "src/App.tsx"), sourceText),
  ]);

  return {
    cleanupDirectory: sourceRoot,
    projectRoot: sourceRoot,
    resolvedRevision: null,
    sourceDigest: SOURCE_DIGEST,
    sourceKind: "snapshot",
    sourceRoot,
  };
};

const expectDirectoryRemoved = async (directory: string): Promise<void> => {
  await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  cleanupDirectories.delete(directory);
};

afterEach(async () => {
  await Promise.all(
    [...cleanupDirectories].map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
  cleanupDirectories.clear();
});

describe("runHostedScan worker isolation", () => {
  it("returns a validated report from the isolated scanner", async () => {
    const source = await createMaterializedSource(
      "export const App = () => <main>Worker fixture</main>;\n"
    );

    const result = await runHostedScan(source);

    expect(result).toMatchObject({
      report: {
        packageName: "worker-fixture",
        source: { digest: SOURCE_DIGEST, kind: "snapshot" },
      },
      scan: { status: "completed" },
    });
    await expectDirectoryRemoved(source.cleanupDirectory);
  });

  it("terminates an active worker before cleaning up aborted source", async () => {
    const source = await createMaterializedSource(
      "export const App = () => <main>Abort fixture</main>;\n"
    );
    const controller = new AbortController();
    const timeoutError = new HostedScanError("Test deadline reached.", {
      code: "SCAN_TIMEOUT",
      retryable: true,
      status: 504,
    });

    const scan = runHostedScan(source, controller.signal);
    controller.abort(timeoutError);

    await expect(scan).rejects.toBe(timeoutError);
    await expectDirectoryRemoved(source.cleanupDirectory);
  });

  it("contains parser stack failures inside the worker", async () => {
    const nestingDepth = 5000;
    const source = await createMaterializedSource(
      `export const App = () => ${"(".repeat(nestingDepth)}<main />${")".repeat(nestingDepth)};\n`
    );

    await expect(runHostedScan(source)).rejects.toMatchObject({
      code: "SCAN_WORKER_FAILED",
      retryable: true,
      status: 500,
    });
    await expectDirectoryRemoved(source.cleanupDirectory);
  });
});
