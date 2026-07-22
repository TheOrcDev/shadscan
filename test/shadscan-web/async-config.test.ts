import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASYNC_JOB_TTL_HOURS,
  DEFAULT_ASYNC_MAX_ATTEMPTS,
  DEFAULT_ASYNC_MAX_CONCURRENCY,
  DEFAULT_SYNC_RELEVANT_FILES,
  DEFAULT_SYNC_RELEVANT_MIB,
  getWebAsyncConfig,
} from "../../lib/shadscan-web/async-config";

describe("getWebAsyncConfig", () => {
  it("keeps asynchronous dispatch disabled by default", () => {
    expect(getWebAsyncConfig({})).toEqual({
      enabled: false,
      jobTtlSeconds: DEFAULT_ASYNC_JOB_TTL_HOURS * 60 * 60,
      maxAttempts: DEFAULT_ASYNC_MAX_ATTEMPTS,
      maxConcurrency: DEFAULT_ASYNC_MAX_CONCURRENCY,
      syncRelevantBytes: DEFAULT_SYNC_RELEVANT_MIB * 1024 * 1024,
      syncRelevantFiles: DEFAULT_SYNC_RELEVANT_FILES,
    });
  });

  it("reads bounded asynchronous thresholds", () => {
    expect(
      getWebAsyncConfig({
        SHADSCAN_WEB_ASYNC_ENABLED: "true",
        SHADSCAN_WEB_ASYNC_JOB_TTL_HOURS: "48",
        SHADSCAN_WEB_ASYNC_MAX_ATTEMPTS: "7",
        SHADSCAN_WEB_ASYNC_MAX_CONCURRENCY: "4",
        SHADSCAN_WEB_SYNC_RELEVANT_FILES: "2000",
        SHADSCAN_WEB_SYNC_RELEVANT_MIB: "24",
      })
    ).toEqual({
      enabled: true,
      jobTtlSeconds: 48 * 60 * 60,
      maxAttempts: 7,
      maxConcurrency: 4,
      syncRelevantBytes: 24 * 1024 * 1024,
      syncRelevantFiles: 2000,
    });
  });

  it.each([
    ["SHADSCAN_WEB_ASYNC_ENABLED", "yes"],
    ["SHADSCAN_WEB_ASYNC_JOB_TTL_HOURS", "0"],
    ["SHADSCAN_WEB_ASYNC_JOB_TTL_HOURS", "169"],
    ["SHADSCAN_WEB_ASYNC_MAX_ATTEMPTS", "11"],
    ["SHADSCAN_WEB_ASYNC_MAX_CONCURRENCY", "11"],
    ["SHADSCAN_WEB_SYNC_RELEVANT_FILES", "10001"],
    ["SHADSCAN_WEB_SYNC_RELEVANT_MIB", "51"],
  ])("rejects an invalid %s value", (variableName, value) => {
    const environment =
      variableName === "SHADSCAN_WEB_ASYNC_ENABLED"
        ? { [variableName]: value }
        : { SHADSCAN_WEB_ASYNC_ENABLED: "true", [variableName]: value };
    expect(() => getWebAsyncConfig(environment)).toThrow(variableName);
  });

  it("ignores stale async tuning while dispatch is disabled", () => {
    expect(
      getWebAsyncConfig({
        SHADSCAN_WEB_ASYNC_ENABLED: "false",
        SHADSCAN_WEB_SYNC_RELEVANT_FILES: "invalid",
      }).enabled
    ).toBe(false);
  });
});
