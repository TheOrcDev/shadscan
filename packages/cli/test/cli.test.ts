import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { createProgram } from "../src/cli";
import { normalizeCliFailure } from "../src/cli-error";
import { ProjectDiscoveryError } from "../src/discovery";

describe("CLI contract", () => {
  it("reads its version from the package manifest", () => {
    expect(createProgram().version()).toBe(packageJson.version);
  });

  it("turns expected discovery failures into stable messages", () => {
    expect(
      normalizeCliFailure(new ProjectDiscoveryError("No package.json found."))
    ).toEqual({
      code: "PROJECT_NOT_FOUND",
      message: "No package.json found.",
    });
    expect(
      normalizeCliFailure(new SyntaxError("private parser detail"))
    ).toEqual({
      code: "INVALID_PROJECT_METADATA",
      message: "Project metadata could not be parsed.",
    });
    expect(normalizeCliFailure(new Error("private runtime detail"))).toEqual({
      code: "AUDIT_FAILED",
      message: "Shadscan could not complete the audit.",
    });
  });
});
