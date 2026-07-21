import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseProjectSourceFiles } from "../src/ast";
import { discoverProject } from "../src/discovery";
import { findFiles, getProjectSourceFiles } from "../src/rules/source-files";
import { createRuleFixture } from "./rule-fixture";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    await rm(cleanupPath, { force: true, recursive: true });
  }
});

describe("project source index", () => {
  it("caches source text and parsed ASTs for one discovery", async () => {
    const fixture = await createRuleFixture();
    cleanupPaths.push(fixture.rootDir);
    await fixture.write(
      "components/real.tsx",
      "export const Real = () => <button>Real</button>;\n"
    );

    const project = await discoverProject(fixture.rootDir);
    const firstSourceFiles = await getProjectSourceFiles(project);
    const firstParsedFiles = await parseProjectSourceFiles(project);
    await fixture.write(
      "components/late.tsx",
      "export const Late = () => <button>Late</button>;\n"
    );

    expect(await getProjectSourceFiles(project)).toBe(firstSourceFiles);
    expect(await parseProjectSourceFiles(project)).toBe(firstParsedFiles);
    expect(firstSourceFiles.map((file) => path.basename(file.path))).toEqual([
      "real.tsx",
    ]);
  });

  it("excludes tests, stories, fixtures, and generated source", async () => {
    const fixture = await createRuleFixture();
    cleanupPaths.push(fixture.rootDir);
    await fixture.write("components/real.tsx", "export const Real = 1;\n");
    await fixture.write("components/real.test.tsx", "export const Test = 1;\n");
    await fixture.write(
      "components/real.stories.tsx",
      "export const Story = 1;\n"
    );
    await fixture.write(
      "components/fixtures/fake.tsx",
      "export const Fixture = 1;\n"
    );
    await fixture.write(
      "components/generated/fake.tsx",
      "export const Generated = 1;\n"
    );

    const project = await discoverProject(fixture.rootDir);
    const files = await getProjectSourceFiles(project);

    expect(files.map((file) => path.basename(file.path))).toEqual(["real.tsx"]);
  });

  it("indexes root Pages Router files and deeply nested source", async () => {
    const fixture = await createRuleFixture();
    cleanupPaths.push(fixture.rootDir);
    await fixture.write(
      "pages/index.tsx",
      "export default function Page() { return <main />; }\n"
    );
    await fixture.write(
      "components/one/two/three/four/five/six/seven/eight/nine/deep.tsx",
      "export const Deep = () => <button>Deep</button>;\n"
    );

    const project = await discoverProject(fixture.rootDir);
    const files = await getProjectSourceFiles(project);
    const relativePaths = files.map((file) =>
      path.relative(fixture.rootDir, file.path)
    );

    expect(relativePaths).toContain("pages/index.tsx");
    expect(relativePaths).toContain(
      "components/one/two/three/four/five/six/seven/eight/nine/deep.tsx"
    );
  });

  it("does not follow files or directories linked outside the project", async () => {
    const fixture = await createRuleFixture();
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "shadscan-outside-"));
    cleanupPaths.push(fixture.rootDir, outsideRoot);
    await mkdir(path.join(fixture.rootDir, "components"), { recursive: true });
    await writeFile(
      path.join(outsideRoot, "injected.tsx"),
      "export const Injected = () => <CommandDialog />;\n"
    );
    await symlink(
      outsideRoot,
      path.join(fixture.rootDir, "components", "outside-directory")
    );
    await symlink(
      path.join(outsideRoot, "injected.tsx"),
      path.join(fixture.rootDir, "components", "outside-file.tsx")
    );

    const project = await discoverProject(fixture.rootDir);
    const sourceFiles = await getProjectSourceFiles(project);
    const matchedFiles = await findFiles(fixture.rootDir, [
      "components/**/*.tsx",
    ]);

    expect(sourceFiles).toEqual([]);
    expect(matchedFiles).toEqual([]);
  });
});
