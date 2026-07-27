import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { highConfidenceRules } from "../src/rules/high-confidence";

const RULE_ID = "theme-hotkey-present";
const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-hotkeys-"));
  tempDirs.push(fixtureDir);

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

/**
 * Writes a project whose only dark-mode shortcut is the supplied toggle
 * component, so the rule's verdict is attributable to that source alone.
 */
const writeProject = async (
  rootDir: string,
  dependency: string,
  toggleSource: string
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          [dependency]: "1.0.0",
          "next-themes": "0.4.6",
          react: "19.2.4",
        },
        name: "hotkey-fixture",
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(rootDir, "src/theme-toggle.tsx", toggleSource);
};

const tanstackToggle = (
  keySpec: string,
  options: string | null
): string => `import { useHotkey } from "@tanstack/react-hotkeys";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useHotkey(
    ${keySpec},
    (event) => {
      event.preventDefault();
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }${options ? `,\n    ${options}` : ""}
  );

  return <button type="button">Theme</button>;
}
`;

const hookToggle = (
  keySpec: string,
  options: string | null
): string => `import { useHotkeys } from "react-hotkeys-hook";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useHotkeys(
    ${keySpec},
    () => {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }${options ? `,\n    ${options}` : ""}
  );

  return <button type="button">Theme</button>;
}
`;

const getStatus = async (rootDir: string) => {
  const report = await runAudit(rootDir, { rules: highConfidenceRules });

  return report.findings.find((finding) => finding.id === RULE_ID)?.status;
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("declarative dark-mode hotkeys", () => {
  describe("@tanstack/react-hotkeys", () => {
    it("passes an explicit ignoreInputs on a Mod combo", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        tanstackToggle('"Mod+Shift+D"', "{ ignoreInputs: true }")
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    it("passes a bare key that defaults to ignoring inputs", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        tanstackToggle('"d"', null)
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    it("passes a Shift combo that defaults to ignoring inputs", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        tanstackToggle('"Shift+D"', null)
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    // The documented default is false for Ctrl/Meta shortcuts, so an
    // unguarded Mod combo fires while the user is typing.
    it("fails a Mod combo that relies on the default", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        tanstackToggle('"Mod+D"', null)
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails an explicit ignoreInputs: false", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        tanstackToggle('"d"', "{ ignoreInputs: false }")
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("passes a bulk useHotkeys definition list", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "@tanstack/react-hotkeys",
        `import { useHotkeys } from "@tanstack/react-hotkeys";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useHotkeys([
    {
      hotkey: "Mod+Shift+D",
      callback: () => {
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      },
      options: { ignoreInputs: true },
    },
  ]);

  return <button type="button">Theme</button>;
}
`
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });
  });

  describe("react-hotkeys-hook", () => {
    // enableOnFormTags defaults to false, so the default is already guarded.
    it("passes when no options are supplied", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"mod+shift+d"', null)
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    it("passes when the third argument is a dependency array", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"d"', "[resolvedTheme]")
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    it("passes an explicitly empty enableOnFormTags", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"d"', "{ enableOnFormTags: [] }")
      );

      expect(await getStatus(rootDir)).toBe("pass");
    });

    it("fails when form tags are enabled", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"d"', "{ enableOnFormTags: true }")
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails when a non-empty form tag list is enabled", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"d"', '{ enableOnFormTags: ["INPUT"] }')
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });
  });

  describe("unverifiable registrations", () => {
    it("fails a non-literal key spec", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle("SHORTCUT", null)
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails options passed as an identifier", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"d"', "hotkeyOptions")
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails a shortcut that does not bind the d key", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        hookToggle('"mod+k"', null)
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails a callback that never toggles the theme", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        `import { useHotkeys } from "react-hotkeys-hook";

export function ThemeToggle() {
  useHotkeys("d", () => {
    console.log("pressed");
  });

  return <button type="button">Theme</button>;
}
`
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    // A local hook of the same name carries none of the library's guarantees.
    it("fails a locally defined useHotkeys that shadows the import", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "react-hotkeys-hook",
        `import { useTheme } from "next-themes";

const useHotkeys = (_keys: string, callback: () => void) => {
  callback();
};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useHotkeys("d", () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  });

  return <button type="button">Theme</button>;
}
`
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });

    it("fails a hotkey hook from an unrecognized library", async () => {
      const rootDir = await createFixture();
      await writeProject(
        rootDir,
        "some-other-hotkeys",
        `import { useHotkeys } from "some-other-hotkeys";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  useHotkeys("d", () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  });

  return <button type="button">Theme</button>;
}
`
      );

      expect(await getStatus(rootDir)).toBe("fail");
    });
  });
});
