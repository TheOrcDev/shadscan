import {
  BUNDLED_RULESET_VERSION,
  ENGINE_VERSION,
} from "@shadscan/cli";
import { describe, expect, it, vi } from "vitest";
import type { HostedScanResponse } from "../../lib/shadscan-api/contracts";
import {
  createScanCacheDescriptor,
  getScanCacheConfig,
  readScanCache,
  readScanCacheFailOpen,
  writeScanCache,
  writeScanCacheFailOpen,
} from "../../lib/shadscan-web/scan-cache";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const IDENTITY = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  projectPath: ".",
  repositoryKey: "acme/widget",
};

const CURRENT_RESPONSE: HostedScanResponse = {
  ...WEB_SCAN_COMPLETE_FIXTURE.result,
  report: {
    ...WEB_SCAN_COMPLETE_FIXTURE.result.report,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: BUNDLED_RULESET_VERSION,
  },
  scan: {
    ...WEB_SCAN_COMPLETE_FIXTURE.result.scan,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: BUNDLED_RULESET_VERSION,
  },
};

describe("web scan cache", () => {
  it("parses a disabled seven-day default and bounded opt-in", () => {
    expect(getScanCacheConfig({})).toEqual({
      enabled: false,
      ttlSeconds: 7 * 24 * 60 * 60,
    });
    expect(
      getScanCacheConfig({
        SHADSCAN_WEB_CACHE_ENABLED: "true",
        SHADSCAN_WEB_CACHE_TTL_HOURS: "24",
      })
    ).toEqual({ enabled: true, ttlSeconds: 86_400 });
  });

  it.each([
    ["SHADSCAN_WEB_CACHE_ENABLED", "yes"],
    ["SHADSCAN_WEB_CACHE_TTL_HOURS", "0"],
    ["SHADSCAN_WEB_CACHE_TTL_HOURS", "721"],
  ])("rejects invalid %s values", (name, value) => {
    expect(() => getScanCacheConfig({ [name]: value })).toThrow(
      expect.objectContaining({ code: "SOURCE_CONFIGURATION_INVALID" })
    );
  });

  it("keys immutable repository, path, category, and version identity", () => {
    const descriptor = createScanCacheDescriptor(IDENTITY);

    expect(descriptor.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptor.repositoryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(descriptor)).not.toContain("acme/widget");
    expect(
      createScanCacheDescriptor({ ...IDENTITY, projectPath: "apps/web" })
        .cacheKey
    ).not.toBe(descriptor.cacheKey);
    expect(
      createScanCacheDescriptor({ ...IDENTITY, category: "accessibility" })
        .cacheKey
    ).not.toBe(descriptor.cacheKey);
  });

  it("returns a validated hit with a fresh scan id", async () => {
    const execute = vi.fn(() =>
      Promise.resolve([{ payload: CURRENT_RESPONSE }])
    );

    const first = await readScanCache(IDENTITY, execute);
    const second = await readScanCache(IDENTITY, execute);

    expect(first?.scan.id).toMatch(/^scan_[a-f0-9]{32}$/);
    expect(first?.scan.id).not.toBe(CURRENT_RESPONSE.scan.id);
    expect(second?.scan.id).not.toBe(first?.scan.id);
    expect(first?.report).toEqual(CURRENT_RESPONSE.report);
  });

  it("treats a stale or invalid payload as a miss through fail-open reads", async () => {
    await expect(
      readScanCacheFailOpen(
        { enabled: true, ttlSeconds: 3600 },
        IDENTITY,
        () => Promise.resolve([{ payload: WEB_SCAN_COMPLETE_FIXTURE.result }])
      )
    ).resolves.toBeUndefined();
    await expect(
      readScanCacheFailOpen(
        { enabled: true, ttlSeconds: 3600 },
        IDENTITY,
        () => Promise.reject(new Error("database unavailable"))
      )
    ).resolves.toBeUndefined();
  });

  it("writes only current successful payloads and fails open", async () => {
    const execute = vi.fn(() => Promise.resolve([]));

    await writeScanCache(IDENTITY, CURRENT_RESPONSE, 3600, execute);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        projectPath: ".",
      }),
      CURRENT_RESPONSE,
      3600
    );

    await expect(
      writeScanCacheFailOpen(
        { enabled: true, ttlSeconds: 3600 },
        IDENTITY,
        CURRENT_RESPONSE,
        () => Promise.reject(new Error("database unavailable"))
      )
    ).resolves.toBeUndefined();
  });
});
