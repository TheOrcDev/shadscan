import { afterEach, describe, expect, it } from "vitest";
import { AUDIT_REPORT_SCHEMA_VERSION, runAudit } from "../src/audit";
import { discoverProject } from "../src/discovery";
import { asyncActionPendingStateRule } from "../src/rules/async-action-pending-state";
import { getProjectSourceFiles } from "../src/rules/source-files";
import {
  resolveProjectIgnorePatterns,
  ScanConfigError,
} from "../src/scan-ignores";
import { createRuleFixture, runRule } from "./rule-fixture";

const fixtures: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

const GENERATED_MUTATION = `import { useMutation } from "@tanstack/react-query";

export function useAdminDisableSession() {
  return useMutation({
    mutationFn: async () => undefined,
  });
}
`;

const PAGE_WITH_PENDING = `import { useMutation } from "@tanstack/react-query";

export function SessionsPage() {
  const disableSession = useMutation({
    mutationFn: async () => undefined,
  });

  return (
    <form
      onSubmit={() => {
        disableSession.mutate();
      }}
    >
      <button disabled={disableSession.isPending} type="submit">
        {disableSession.isPending ? <Spinner /> : "Disable"}
      </button>
    </form>
  );
}
`;

const PAGE_WITHOUT_PENDING = `import { useMutation } from "@tanstack/react-query";

export function SessionsPage() {
  const disableSession = useMutation({
    mutationFn: async () => undefined,
  });

  return (
    <form
      onSubmit={() => {
        disableSession.mutate();
      }}
    >
      <button type="submit">Disable</button>
    </form>
  );
}
`;

describe("scan ignore patterns", () => {
  it("loads extra ignores from shadscan.config.jsonc and CLI flags", async () => {
    const fixture = await createRuleFixture();
    fixtures.push(fixture);
    await fixture.write(
      "shadscan.config.jsonc",
      `{
        // Generated OpenAPI clients
        "ignore": ["src/api/**"]
      }\n`
    );

    await expect(
      resolveProjectIgnorePatterns({
        cliIgnorePatterns: ["src/gen/**"],
        rootDir: fixture.rootDir,
      })
    ).resolves.toEqual(["src/api/**", "src/gen/**"]);
  });

  it("loads extra ignores from package.json when no config file exists", async () => {
    const fixture = await createRuleFixture();
    fixtures.push(fixture);
    await fixture.write(
      "package.json",
      `${JSON.stringify(
        {
          dependencies: { react: "19.2.4" },
          name: "expanded-rule-fixture",
          shadscan: { ignore: ["src/api/**"] },
        },
        null,
        2
      )}\n`
    );

    await expect(
      resolveProjectIgnorePatterns({ rootDir: fixture.rootDir })
    ).resolves.toEqual(["src/api/**"]);
  });

  it("rejects negation globs and absolute paths", async () => {
    const fixture = await createRuleFixture();
    fixtures.push(fixture);

    await expect(
      resolveProjectIgnorePatterns({
        cliIgnorePatterns: ["!**/node_modules/**"],
        rootDir: fixture.rootDir,
      })
    ).rejects.toBeInstanceOf(ScanConfigError);

    await expect(
      resolveProjectIgnorePatterns({
        cliIgnorePatterns: ["/tmp/src/**"],
        rootDir: fixture.rootDir,
      })
    ).rejects.toBeInstanceOf(ScanConfigError);
  });

  it("excludes ignored generated clients from the source index", async () => {
    const fixture = await createRuleFixture();
    fixtures.push(fixture);
    await fixture.write("src/App.tsx", "export const App = () => <main />;\n");
    await fixture.write("src/api/hooks/use-session.ts", GENERATED_MUTATION);
    await fixture.write(
      "shadscan.config.jsonc",
      `${JSON.stringify({ ignore: ["src/api/**"] })}\n`
    );

    const project = await discoverProject(fixture.rootDir);
    const files = await getProjectSourceFiles(project);
    const relativePaths = files.map((file) =>
      file.path.slice(fixture.rootDir.length + 1).replaceAll("\\", "/")
    );

    expect(project.ignorePatterns).toEqual(["src/api/**"]);
    expect(relativePaths).toContain("src/App.tsx");
    expect(
      relativePaths.some((filePath) => filePath.includes("src/api/"))
    ).toBe(false);
  });

  it("stops generated mutations from failing pending-state when ignored", async () => {
    const fixture = await createRuleFixture({
      "@tanstack/react-query": "5.0.0",
      react: "19.2.4",
    });
    fixtures.push(fixture);
    await fixture.write("src/sessions-page.tsx", PAGE_WITH_PENDING);
    await fixture.write("src/api/hooks/use-session.ts", GENERATED_MUTATION);

    expect(
      (await runRule(fixture.rootDir, asyncActionPendingStateRule)).status
    ).toBe("fail");

    await fixture.write(
      "shadscan.config.jsonc",
      `${JSON.stringify({ ignore: ["src/api/**"] })}\n`
    );

    expect(
      (await runRule(fixture.rootDir, asyncActionPendingStateRule)).status
    ).toBe("pass");
  });

  it("still fails pending-state when application source omits pending UX", async () => {
    const fixture = await createRuleFixture({
      "@tanstack/react-query": "5.0.0",
      react: "19.2.4",
    });
    fixtures.push(fixture);
    await fixture.write("src/sessions-page.tsx", PAGE_WITHOUT_PENDING);
    await fixture.write("src/api/hooks/use-session.ts", GENERATED_MUTATION);
    await fixture.write(
      "shadscan.config.jsonc",
      `${JSON.stringify({ ignore: ["src/api/**"] })}\n`
    );

    expect(
      (await runRule(fixture.rootDir, asyncActionPendingStateRule)).status
    ).toBe("fail");
  });

  it("records extra ignore patterns on the JSON coverage object", async () => {
    const fixture = await createRuleFixture();
    fixtures.push(fixture);
    await fixture.write("src/App.tsx", "export const App = () => <main />;\n");

    const report = await runAudit(fixture.rootDir, {
      ignorePatterns: ["src/api/**"],
      rules: [asyncActionPendingStateRule],
    });

    expect(report.schemaVersion).toBe(AUDIT_REPORT_SCHEMA_VERSION);
    expect(report.coverage.ignorePatterns).toEqual(["src/api/**"]);
  });
});
