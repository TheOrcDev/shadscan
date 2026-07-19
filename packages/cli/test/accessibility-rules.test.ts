import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { accessibilityRules } from "../src/rules/accessibility";
import { customControlsHaveLabelsRule } from "../src/rules/custom-controls-have-labels";

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

const writeGeneratedFormPrimitives = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "components/ui/input.tsx",
    `
      export function Input(props) {
        return <input data-slot="input" {...props} />;
      }
    `
  );
  await writeFixtureFile(
    rootDir,
    "components/ui/textarea.tsx",
    `
      export function Textarea(props) {
        return <textarea data-slot="textarea" {...props} />;
      }
    `
  );
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

  it("ignores generated input-group focus delegation", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "components/ui/input-group.tsx",
      `
        export function InputGroupAddon() {
          return (
            <div
              data-slot="input-group-addon"
              onClick={(event) => event.currentTarget.parentElement?.querySelector("input")?.focus()}
              role="group"
            />
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find(
        (finding) => finding.id === "interactive-elements-are-semantic"
      )?.status
    ).toBe("pass");
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

  it("does not report generated pass-through form primitives", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "components/ui/input-group.tsx",
      `
        export function InputGroupInput(props) {
          return <Input data-slot="input-group-control" {...props} />;
        }
        export function InputGroupTextarea(props) {
          return <Textarea data-slot="input-group-control" {...props} />;
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("pass");
  });

  it("correlates FieldLabel and control IDs that use the same expression", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App({ row }) {
          return (
            <form>
              <FieldLabel htmlFor={\`\${row.id}-target\`}>Target</FieldLabel>
              <Input id={\`\${row.id}-target\`} />
            </form>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("pass");
  });

  it("accepts accessible names and explicit labels on form wrappers", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return (
            <form>
              <Input aria-label="Email" />
              <Label htmlFor="bio">Biography</Label>
              <Textarea id="bio" />
            </form>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("pass");
  });

  it("accepts a FormLabel in the nearest shadcn FormItem", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input /></FormControl>
              <FormMessage />
            </FormItem>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("pass");
  });

  it("requires FormControl for implicit FormLabel association", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <Input />
            </FormItem>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("fail");
  });

  it("reports unlabeled form wrappers at their rendered call sites", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/newsletter.tsx",
      `
        export function Newsletter() {
          return (
            <>
              <FormItem>
                <FormControl>
                  <Input placeholder="Email" name="email" aria-describedby="email-error" />
                </FormControl>
                <FormMessage id="email-error" />
              </FormItem>
              <FormItem>
                <FormControl>
                  <Input placeholder="Username" name="username" />
                </FormControl>
              </FormItem>
            </>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: [...accessibilityRules, customControlsHaveLabelsRule],
    });
    const finding = report.findings.find(
      (candidate) => candidate.id === "forms-have-labels"
    );

    expect(finding?.status).toBe("fail");
    expect(finding?.evidence).toHaveLength(2);
    expect(finding?.evidence.map((item) => item.filePath)).toEqual([
      "src/newsletter.tsx",
      "src/newsletter.tsx",
    ]);
    expect(finding?.evidence.map((item) => item.line)).toEqual([7, 13]);
    expect(
      finding?.evidence.every((item) => item.message.includes("Input"))
    ).toBe(true);
    expect(
      report.findings.find(
        (candidate) => candidate.id === "custom-controls-have-labels"
      )?.status
    ).toBe("pass");
  });

  it("treats a dynamic FormLabel as advisory", async () => {
    const rootDir = await createFixture();
    await writeGeneratedFormPrimitives(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App({ label }) {
          return (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl><Input /></FormControl>
            </FormItem>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "forms-have-labels")
        ?.status
    ).toBe("advisory");
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

  it("correlates dialog titles placed beside content under the same root", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return (
            <ShadcnCommandDialog>
              <DialogHeader><DialogTitle>Command Palette</DialogTitle></DialogHeader>
              <DialogContent>Commands</DialogContent>
            </ShadcnCommandDialog>
          );
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: accessibilityRules,
    });

    expect(
      report.findings.find(
        (finding) => finding.id === "dialogs-have-accessible-names"
      )?.status
    ).toBe("pass");
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

    await writeFixtureFile(
      rootDir,
      "src/app.tsx",
      `
        export function App() {
          return (
            <Dialog>
              <DialogContent>
                <Dialog>
                  <DialogTitle>Nested title</DialogTitle>
                  <DialogContent>Nested content</DialogContent>
                </Dialog>
              </DialogContent>
            </Dialog>
          );
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
