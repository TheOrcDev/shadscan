import { describe, expect, it } from "vitest";
import { maxDuration, runtime } from "@/app/scan/page";
import { GITHUB_SOURCE_TIMEOUT_MS } from "@/lib/shadscan-api/github-source";

describe("web scan route configuration", () => {
  it("uses the Node.js runtime with room for the bounded GitHub timeout", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(30);
    expect(GITHUB_SOURCE_TIMEOUT_MS).toBeLessThan(maxDuration * 1000);
  });
});
