import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEB_SOURCE_LIMITS,
  getWebSourceConfig,
  MEBIBYTE,
} from "../../lib/shadscan-web/source-config";

describe("web source configuration", () => {
  it("returns moderate archive defaults without reading global state", () => {
    expect(getWebSourceConfig({})).toEqual({
      limits: DEFAULT_WEB_SOURCE_LIMITS,
      mode: "archive",
    });
  });

  it("parses bounded source limits and acquisition mode", () => {
    expect(
      getWebSourceConfig({
        SHADSCAN_WEB_MAX_ARCHIVE_ENTRIES: "24000",
        SHADSCAN_WEB_MAX_COMPRESSED_MIB: "48",
        SHADSCAN_WEB_MAX_EXPANDED_MIB: "192",
        SHADSCAN_WEB_MAX_RETAINED_FILE_MIB: "12",
        SHADSCAN_WEB_SOURCE_MODE: "auto",
      })
    ).toMatchObject({
      limits: {
        maxCompressedBytes: 48 * MEBIBYTE,
        maxExpandedBytes: 192 * MEBIBYTE,
        maxFileBytes: 12 * MEBIBYTE,
        maxRawEntries: 24_000,
      },
      mode: "auto",
    });
  });

  it.each([
    ["SHADSCAN_WEB_MAX_COMPRESSED_MIB", "65"],
    ["SHADSCAN_WEB_MAX_EXPANDED_MIB", "257"],
    ["SHADSCAN_WEB_MAX_ARCHIVE_ENTRIES", "50001"],
    ["SHADSCAN_WEB_MAX_RETAINED_FILE_MIB", "17"],
    ["SHADSCAN_WEB_MAX_COMPRESSED_MIB", "0"],
    ["SHADSCAN_WEB_MAX_EXPANDED_MIB", "1.5"],
    ["SHADSCAN_WEB_SOURCE_MODE", "buffered"],
  ])("rejects invalid %s values", (variableName, value) => {
    expect(() => getWebSourceConfig({ [variableName]: value })).toThrow(
      expect.objectContaining({
        code: "SOURCE_CONFIGURATION_INVALID",
      })
    );
  });
});
