import { describe, expect, it } from "vitest";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import { toWebScanError } from "../../lib/shadscan-web/errors";

describe("web scan errors", () => {
  it("reports relevant file limits in files rather than bytes", () => {
    const error = new HostedScanError(
      "The selected project exceeds a source limit.",
      {
        code: "ARCHIVE_EXPANDED_TOO_LARGE",
        sourceLimit: {
          kind: "relevant_files",
          limit: 10_000,
          observed: 10_001,
          unit: "entries",
        },
        status: 422,
      }
    );

    expect(toWebScanError(error)).toMatchObject({
      code: "SOURCE_TOO_LARGE",
      message:
        "The relevant repository source has more than 10,001 files; the scanner limit is 10,000. Run shadscan locally instead.",
      sourceLimit: {
        kind: "relevant_files",
        limit: 10_000,
        observed: 10_001,
        unit: "entries",
      },
    });
  });
});
