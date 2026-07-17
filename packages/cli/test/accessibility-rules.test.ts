import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { accessibilityRules } from "../src/rules/accessibility";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-a11y-"));
  tempDirs.push(fixtureDir);
  await writeFixtureFile(
    fixtureDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          react: "19.2.4",
        },
      },
      null,
      2
    )}\n`
  );

  return fixtureDir;
};

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("accessibility rules", () => {
  it("fails an icon-only button without an accessible label", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        function SearchIcon() {
          return <svg />;
        }

        export function App() {
          return <button><SearchIcon /></button>;
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find(
        (finding) => finding.id === "icon-buttons-have-labels"
      )?.status
    ).toBe("fail");
  });

  it("distinguishes empty and dynamic button labels", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      'export function App() { return <button aria-label=""><SearchIcon /></button>; }\n'
    );

    expect(
      (
        await runAudit(rootDir, {
          rules: accessibilityRules,
        })
      ).findings.find((finding) => finding.id === "icon-buttons-have-labels")
        ?.status
    ).toBe("fail");

    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      "export function App({ label }) { return <button aria-label={label}><SearchIcon /></button>; }\n"
    );

    expect(
      (
        await runAudit(rootDir, {
          rules: accessibilityRules,
        })
      ).findings.find((finding) => finding.id === "icon-buttons-have-labels")
        ?.status
    ).toBe("advisory");
  });

  it("passes icon buttons with labels and form controls with labels", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        function SearchIcon() {
          return <svg />;
        }

        export function App() {
          return (
            <form>
              <button aria-label="Search"><SearchIcon /></button>
              <label htmlFor="email">Email</label>
              <input id="email" />
            </form>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(report.findings.every((finding) => finding.status === "pass")).toBe(
      true
    );
  });

  it("fails clickable divs without keyboard support", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      "export function App() { return <div onClick={() => {}}>Open</div>; }\n"
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find(
        (finding) => finding.id === "interactive-elements-are-semantic"
      )?.status
    ).toBe("fail");
  });

  it("requires role and focusability on keyboard-enabled click targets", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      "export function App() { return <div onClick={open} onKeyDown={open}>Open</div>; }\n"
    );

    expect(
      (
        await runAudit(rootDir, {
          rules: accessibilityRules,
        })
      ).findings.find(
        (finding) => finding.id === "interactive-elements-are-semantic"
      )?.status
    ).toBe("fail");

    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      'export function App() { return <div role="button" tabIndex={0} onClick={open} onKeyDown={open}>Open</div>; }\n'
    );

    expect(
      (
        await runAudit(rootDir, {
          rules: accessibilityRules,
        })
      ).findings.find(
        (finding) => finding.id === "interactive-elements-are-semantic"
      )?.status
    ).toBe("pass");
  });

  it("fails unlabeled form controls", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      'export function App() { return <input name="email" />; }\n'
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("fail");
  });

  it("fails dialog content without a title", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      "export function App() { return <DialogContent>Settings</DialogContent>; }\n"
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find(
        (finding) => finding.id === "dialogs-have-accessible-names"
      )?.status
    ).toBe("fail");
  });

  it("requires a title inside every dialog subtree", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return <>
            <DialogContent><DialogTitle>Named</DialogTitle></DialogContent>
            <DialogContent>Still unnamed</DialogContent>
          </>;
        }
      `
    );

    expect(
      (
        await runAudit(rootDir, {
          rules: accessibilityRules,
        })
      ).findings.find(
        (finding) => finding.id === "dialogs-have-accessible-names"
      )?.status
    ).toBe("fail");
  });
});
