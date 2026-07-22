import { SCAN_SOURCE_LIMITS } from "@shadscan/cli";
import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_SOURCE_LIMITS } from "../../lib/shadscan-web/source-config";
import { classifyWebScanWorkload } from "../../lib/shadscan-web/workload";

const createSourceEntries = (sizes: number[]) =>
  sizes.map((size, index) => ({
    mode: "100644",
    path: `src/component-${index}.tsx`,
    sha: index.toString(16).padStart(40, "0"),
    size,
    type: "blob" as const,
  }));

const ASYNC_CONFIG = {
  enabled: true,
  jobTtlSeconds: 86_400,
  maxAttempts: 5,
  maxConcurrency: 2,
  syncRelevantBytes: 1024,
  syncRelevantFiles: 2,
};

describe("classifyWebScanWorkload", () => {
  it("keeps a bounded project synchronous", () => {
    expect(
      classifyWebScanWorkload(
        createSourceEntries([100, 200]),
        ".",
        DEFAULT_WEB_SOURCE_LIMITS,
        ASYNC_CONFIG
      )
    ).toEqual({
      kind: "sync",
      relevantBytes: 300,
      relevantFiles: 2,
    });
  });

  it("queues projects above a configured soft threshold", () => {
    expect(
      classifyWebScanWorkload(
        createSourceEntries([400, 400, 400]),
        ".",
        DEFAULT_WEB_SOURCE_LIMITS,
        ASYNC_CONFIG
      )
    ).toMatchObject({ kind: "async", relevantFiles: 3 });
  });

  it("keeps the same project synchronous while async is disabled", () => {
    expect(
      classifyWebScanWorkload(
        createSourceEntries([800, 800, 800]),
        ".",
        DEFAULT_WEB_SOURCE_LIMITS,
        { ...ASYNC_CONFIG, enabled: false }
      ).kind
    ).toBe("sync");
  });

  it("rejects projects beyond the local CLI hard source budget", () => {
    const tooManyEntries = createSourceEntries(
      Array.from({ length: SCAN_SOURCE_LIMITS.maxFiles + 1 }, () => 1)
    );

    expect(() =>
      classifyWebScanWorkload(
        tooManyEntries,
        ".",
        {
          ...DEFAULT_WEB_SOURCE_LIMITS,
          maxRawEntries: SCAN_SOURCE_LIMITS.maxFiles + 1,
        },
        ASYNC_CONFIG
      )
    ).toThrow("source limit");
  });
});
