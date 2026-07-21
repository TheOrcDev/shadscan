import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPreCommitInstallPlan,
  createPreCommitInstallPlan,
  detectPreCommitProtection,
  formatPreCommitInstallPlan,
  type GitCommandRunner,
  PreCommitError,
} from "../src/pre-commit";

const temporaryDirectories: string[] = [];

interface Fixture {
  gitRoot: string;
  hooksPath: string;
  projectRoot: string;
  runGit: GitCommandRunner;
  write: (
    relativePath: string,
    content: string,
    mode?: number
  ) => Promise<string>;
}

const commandResult = (
  stdout = "",
  exitCode = 0
): { exitCode: number; stderr: string; stdout: string } => ({
  exitCode,
  stderr: "",
  stdout,
});

const runHook = async (
  hookPath: string,
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const child = spawn(hookPath, [], {
      cwd,
      env: environment,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode));
  });

const createFixture = async ({
  coreHooksPath = null,
  nestedProject = false,
}: {
  coreHooksPath?: string | null;
  nestedProject?: boolean;
} = {}): Promise<Fixture> => {
  const gitRoot = await mkdtemp(path.join(tmpdir(), "shadscan-pre-commit-"));
  temporaryDirectories.push(gitRoot);
  const projectRoot = nestedProject
    ? path.join(gitRoot, "apps", "web")
    : gitRoot;
  const hooksPath = coreHooksPath
    ? path.resolve(gitRoot, coreHooksPath)
    : path.join(gitRoot, ".git", "hooks");
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(hooksPath, { recursive: true }),
  ]);

  const runGit: GitCommandRunner = (args) => {
    const command = args.join(" ");

    if (command === "rev-parse --show-toplevel") {
      return Promise.resolve(commandResult(`${gitRoot}\n`));
    }

    if (
      command === "rev-parse --path-format=absolute --git-path hooks" ||
      command === "rev-parse --git-path hooks"
    ) {
      return Promise.resolve(commandResult(`${hooksPath}\n`));
    }

    if (command === "config --path --get core.hooksPath") {
      return Promise.resolve(
        coreHooksPath
          ? commandResult(`${coreHooksPath}\n`)
          : commandResult("", 1)
      );
    }

    return Promise.resolve(commandResult("", 1));
  };

  const write = async (
    relativePath: string,
    content: string,
    mode = 0o644
  ): Promise<string> => {
    const filePath = path.join(gitRoot, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { mode });
    await chmod(filePath, mode);
    return filePath;
  };

  return { gitRoot, hooksPath, projectRoot, runGit, write };
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("pre-commit protection detection", () => {
  it("returns unavailable outside a Git worktree", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "shadscan-no-git-"));
    temporaryDirectories.push(projectRoot);

    const detection = await detectPreCommitProtection({
      projectRoot,
      runGit: () => Promise.resolve(commandResult("", 128)),
    });

    expect(detection).toMatchObject({
      gitRoot: null,
      manager: null,
      status: "unavailable",
    });
  });

  it("reports an empty native hooks directory as absent", async () => {
    const fixture = await createFixture();

    const detection = await detectPreCommitProtection(fixture);

    expect(detection).toMatchObject({
      coreHooksPath: null,
      effectiveHooksPath: fixture.hooksPath,
      manager: null,
      status: "absent",
    });
  });

  it("requires an active numeric threshold for native protection", async () => {
    const fixture = await createFixture();
    const hookPath = await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\npnpm dlx @shadscan/cli@0.1.0 --fail-under 92 --no-roast\n",
      0o755
    );

    const detection = await detectPreCommitProtection(fixture);

    expect(detection).toMatchObject({
      activeHookPath: hookPath,
      floor: 92,
      manager: "native",
      status: "protected-active",
    });

    await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\npnpm dlx @shadscan/cli@0.1.0 --json\n",
      0o755
    );
    const advisoryOnly = await detectPreCommitProtection(fixture);
    expect(advisoryOnly).toMatchObject({
      floor: null,
      manager: "native",
      status: "integrable",
    });
  });

  it.each([
    "bun",
    "npm",
    "pnpm",
    "yarn",
  ])("does not trust forwarded arguments on a %s package script", async (packageManager) => {
    const fixture = await createFixture();
    await Promise.all([
      fixture.write(
        "package.json",
        `${JSON.stringify(
          { scripts: { scan: "shadscan --fail-under 92" } },
          null,
          2
        )}\n`
      ),
      fixture.write(
        ".git/hooks/pre-commit",
        `#!/bin/sh\n${packageManager} run scan -- --fail-under 0\n`,
        0o755
      ),
    ]);

    await expect(detectPreCommitProtection(fixture)).resolves.toMatchObject({
      floor: null,
      manager: "native",
      status: "integrable",
    });
  });

  it.each([
    "#!/bin/sh\nshadscan --fail-under 92 || true\n",
    "#!/bin/sh\necho shadscan --fail-under 92\n",
    "#!/bin/sh\nshadscan --fail-under 92\ntrue\n",
    "#!/bin/sh\nshadscan --no-interactive && other --fail-under 92 || exit $?\n",
    "#!/bin/sh\nshadscan --fail-under 92 || true || exit $?\n",
    "#!/bin/sh\nshadscan --fail-under 92 --fail-under 0\n",
    '#!/bin/sh\nshadscan "--category" accessibility --fail-under 92\n',
    "#!/bin/sh\nshadscan --fail-under 92 # || exit $?\ntrue\n",
    '#!/bin/sh\nshadscan --cat"egory" accessibility --fail-under 92\n',
    "#!/bin/sh\nif false; then; shadscan --fail-under 92 || exit $?; fi\n",
    "#!/bin/sh\ngate() {\nshadscan --fail-under 92 || exit $?\n}\n",
    "#!/bin/sh\ntrue ||\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/sh\nexit 0\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/sh\ncommand exit 0\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/sh\nbuiltin exit 0\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/sh\ntime exit 0\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/sh\ntime command exit 0\nshadscan --fail-under 92 || exit $?\n",
    "#!/bin/true\nshadscan --fail-under 92\n",
    "#!/bin/sh -n\nshadscan --fail-under 92\n",
    "#!/bin/bash\nshadscan --fail-under 92\n",
    "#!/bin/zsh\nsetopt NOEXEC\nshadscan --fail-under 92\n",
    "#!/bin/zsh\nchdir /tmp\nshadscan ./apps/web --fail-under 92\n",
    "#!/bin/sh\nshadscan ./some-other-app --fail-under 92\n",
    `#!/bin/sh\ncd /tmp\n# >>> shadscan pre-commit >>>\n_shadscan_previous_status=$?\nif [ "$_shadscan_previous_status" -ne 0 ]; then\n  exit "$_shadscan_previous_status"\nfi\nshadscan --fail-under 92 || exit $?\n# <<< shadscan pre-commit <<<\n`,
  ])("does not certify an insufficient Shadscan gate", async (content) => {
    const fixture = await createFixture();
    await fixture.write(".git/hooks/pre-commit", content, 0o755);

    await expect(detectPreCommitProtection(fixture)).resolves.toMatchObject({
      floor: null,
      status: "integrable",
    });
  });

  it("requires manual validation for a configured Husky gate", async () => {
    const fixture = await createFixture({ coreHooksPath: ".husky/_" });
    await Promise.all([
      fixture.write(
        "package.json",
        `${JSON.stringify(
          {
            devDependencies: { husky: "9.1.7" },
            scripts: {
              "shadscan:check":
                "shadscan --fail-under=91 --no-roast --no-interactive",
            },
          },
          null,
          2
        )}\n`
      ),
      fixture.write(".husky/pre-commit", "pnpm run shadscan:check\n", 0o755),
      fixture.write(
        ".husky/_/pre-commit",
        '#!/bin/sh\n. "$(dirname "$0")/h"\n',
        0o755
      ),
    ]);

    const detection = await detectPreCommitProtection(fixture);

    expect(detection).toMatchObject({
      coreHooksPath: ".husky/_",
      floor: null,
      manager: "husky",
      status: "integrable",
    });
    expect(detection.hookSource?.path).toBe(
      path.join(fixture.gitRoot, ".husky", "pre-commit")
    );
  });

  it.each([
    "#!/bin/sh\ntrue\n",
    '#!/bin/sh\nif false; then\n. "$(dirname "$0")/h"\nfi\n',
    '#!/bin/sh\n. "$(dirname "$0")/h" || true\n',
  ])("does not trust a nonblocking Husky wrapper", async (wrapper) => {
    const fixture = await createFixture({ coreHooksPath: ".husky/_" });
    await Promise.all([
      fixture.write(
        "package.json",
        `${JSON.stringify(
          {
            devDependencies: { husky: "9.1.7" },
            scripts: {
              "shadscan:check": "shadscan --fail-under 91",
            },
          },
          null,
          2
        )}\n`
      ),
      fixture.write(".husky/pre-commit", "pnpm run shadscan:check\n", 0o755),
      fixture.write(".husky/_/pre-commit", wrapper, 0o755),
    ]);

    await expect(detectPreCommitProtection(fixture)).resolves.toMatchObject({
      floor: null,
      manager: "husky",
      status: "integrable",
    });
  });

  it.each([
    "pnpm run shadscan:check || true || exit $?\n",
    "echo pnpm run shadscan:check\n",
  ])("does not trust an indirect package-script mention", async (hook) => {
    const fixture = await createFixture({ coreHooksPath: ".husky/_" });
    await Promise.all([
      fixture.write(
        "package.json",
        `${JSON.stringify(
          {
            devDependencies: { husky: "9.1.7" },
            scripts: {
              "shadscan:check": "shadscan --fail-under 91",
            },
          },
          null,
          2
        )}\n`
      ),
      fixture.write(".husky/pre-commit", hook, 0o755),
      fixture.write(
        ".husky/_/pre-commit",
        '#!/bin/sh\n. "$(dirname "$0")/h"\n',
        0o755
      ),
    ]);

    await expect(detectPreCommitProtection(fixture)).resolves.toMatchObject({
      floor: null,
      manager: "husky",
      status: "integrable",
    });
  });

  it("detects conflicting manager sources without choosing one", async () => {
    const fixture = await createFixture({ coreHooksPath: ".husky/_" });
    await Promise.all([
      fixture.write(".husky/pre-commit", "pnpm lint\n", 0o755),
      fixture.write(
        ".husky/_/pre-commit",
        "#!/bin/sh\n# husky generated wrapper\n",
        0o755
      ),
      fixture.write(
        "lefthook.yml",
        "pre-commit:\n  commands:\n    lint:\n      run: pnpm lint\n"
      ),
    ]);

    const detection = await detectPreCommitProtection(fixture);

    expect(detection.status).toBe("conflict");
    expect(detection.manager).toBeNull();
    expect(detection.managers).toEqual(["husky", "lefthook"]);
  });

  it.each([
    {
      config: [
        "package.json",
        JSON.stringify({
          "simple-git-hooks": { "pre-commit": "pnpm lint" },
        }),
      ],
      manager: "simple-git-hooks",
      wrapper: "#!/bin/sh\n# simple-git-hooks\n",
    },
    {
      config: [
        "lefthook.yml",
        "pre-commit:\n  commands:\n    lint:\n      run: pnpm lint\n",
      ],
      manager: "lefthook",
      wrapper: "#!/bin/sh\nlefthook run pre-commit --force\n",
    },
    {
      config: [
        ".pre-commit-config.yaml",
        "repos:\n  - repo: local\n    hooks:\n      - id: lint\n        entry: pnpm lint\n",
      ],
      manager: "pre-commit",
      wrapper: "#!/bin/sh\n# pre_commit generated\n",
    },
  ])("conservatively detects $manager for manual integration", async ({
    config,
    manager,
    wrapper,
  }) => {
    const fixture = await createFixture();
    await Promise.all([
      fixture.write(config[0], config[1]),
      fixture.write(".git/hooks/pre-commit", wrapper, 0o755),
    ]);

    const detection = await detectPreCommitProtection(fixture);
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      detection,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0-rc.2",
    });

    expect(detection).toMatchObject({ manager, status: "integrable" });
    expect(plan).toMatchObject({ manager, mode: "manual" });
    expect(plan.changes).toEqual([]);
  });
});

describe("pre-commit installation plans", () => {
  it("creates and idempotently applies a native hook after confirmation", async () => {
    const fixture = await createFixture({ nestedProject: true });
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0-rc.2",
    });

    expect(plan.mode).toBe("automatic");
    expect(plan.command).toBe(
      "pnpm dlx @shadscan/cli@0.1.0-rc.2 ./apps/web --fail-under 92 --no-roast --no-interactive"
    );
    expect(plan.changes).toHaveLength(1);
    expect(formatPreCommitInstallPlan(plan)).toContain(
      "Existing hooks will not be executed."
    );

    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: false })
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });

    const firstApply = await applyPreCommitInstallPlan(plan, {
      confirmed: true,
    });
    const hookPath = path.join(fixture.hooksPath, "pre-commit");
    const content = await readFile(hookPath, "utf8");
    const hookStats = await stat(hookPath);

    expect(firstApply).toEqual({
      alreadyApplied: false,
      changedPaths: [hookPath],
    });
    expect(content).toContain("# >>> shadscan pre-commit >>>");
    expect(content.match(/shadscan pre-commit >>>/gu)).toHaveLength(1);
    expect(hookStats.mode % 0o1000).toBe(0o755);
    await expect(detectPreCommitProtection(fixture)).resolves.toMatchObject({
      floor: 92,
      status: "protected-active",
    });

    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).resolves.toEqual({ alreadyApplied: true, changedPaths: [] });
  });

  it("appends to a simple active native hook and preserves its mode", async () => {
    const fixture = await createFixture();
    const hookPath = await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\npnpm lint\n",
      0o750
    );
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "npm",
      score: 87,
      version: "1.2.3",
    });

    expect(plan).toMatchObject({ manager: "native", mode: "automatic" });
    await applyPreCommitInstallPlan(plan, { confirmed: true });

    expect(await readFile(hookPath, "utf8")).toContain(
      "npx --yes @shadscan/cli@1.2.3 --fail-under 87 --no-roast --no-interactive"
    );
    expect((await stat(hookPath)).mode % 0o1000).toBe(0o750);
  });

  it("preserves a failing existing hook status after a passing scan", async () => {
    const fixture = await createFixture();
    const hookPath = await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\nfalse\n",
      0o755
    );
    const fakeBin = path.join(fixture.gitRoot, "fake-bin");
    await mkdir(fakeBin);
    await fixture.write("fake-bin/pnpm", "#!/bin/sh\nexit 0\n", 0o755);
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });

    await applyPreCommitInstallPlan(plan, { confirmed: true });
    const content = await readFile(hookPath, "utf8");

    expect(content.indexOf("false")).toBeLessThan(
      content.indexOf("# >>> shadscan pre-commit >>>")
    );
    expect(content).toContain("_shadscan_previous_status=$?");
    expect(
      await runHook(hookPath, fixture.gitRoot, {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      })
    ).toBe(1);
  });

  it("does not treat a weaker existing floor as sufficient", async () => {
    const fixture = await createFixture();
    await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\nshadscan --fail-under 80\n",
      0o755
    );

    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });

    expect(plan.mode).toBe("manual");
    expect(plan.reason).toContain("already mentions Shadscan");
  });

  it("requires manual setup when a nested project path needs shell quoting", async () => {
    const fixture = await createFixture();
    const projectRoot = path.join(fixture.gitRoot, "apps", "web app");
    await mkdir(projectRoot, { recursive: true });

    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      projectRoot,
      score: 92,
      version: "0.1.0",
    });

    expect(plan).toMatchObject({ mode: "manual" });
    expect(plan.reason).toContain("requires shell quoting");
  });

  it("preserves Husky for manual integration", async () => {
    const fixture = await createFixture({ coreHooksPath: ".husky/_" });
    const wrapperPath = await fixture.write(
      ".husky/_/pre-commit",
      '#!/bin/sh\n. "$(dirname "$0")/h"\n',
      0o755
    );
    const wrapperBefore = await readFile(wrapperPath, "utf8");
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "yarn",
      score: 92,
      version: "0.1.0-rc.2",
    });

    expect(plan).toMatchObject({ manager: "husky", mode: "manual" });
    expect(plan.changes).toEqual([]);
    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).rejects.toMatchObject({ code: "MANUAL_REQUIRED" });
    expect(await readFile(wrapperPath, "utf8")).toBe(wrapperBefore);
  });

  it("refuses opaque hooks and returns a manual fallback", async () => {
    const fixture = await createFixture();
    await fixture.write(
      ".git/hooks/pre-commit",
      "#!/usr/bin/env python3\nprint('pre-commit')\n",
      0o755
    );

    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "bun",
      score: 92,
      version: "0.1.0",
    });

    expect(plan).toMatchObject({ manager: "native", mode: "manual" });
    expect(plan.changes).toEqual([]);
    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).rejects.toBeInstanceOf(PreCommitError);
  });

  it("preserves an unreadable native hook for manual integration", async () => {
    if (process.platform === "win32") {
      return;
    }

    const fixture = await createFixture();
    const hookPath = await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\npnpm lint\n",
      0o000
    );

    try {
      const detection = await detectPreCommitProtection(fixture);
      const plan = await createPreCommitInstallPlan({
        ...fixture,
        detection,
        packageManager: "pnpm",
        score: 92,
        version: "0.1.0",
      });

      expect(detection).toMatchObject({
        hookSource: { exists: true, kind: "unsupported" },
        manager: "native",
        status: "integrable",
      });
      expect(plan).toMatchObject({ manager: "native", mode: "manual" });
      expect(plan.changes).toEqual([]);
    } finally {
      await chmod(hookPath, 0o600);
    }
  });

  it.each([
    "#!/bin/sh\ncd /tmp\npnpm lint\n",
    "#!/bin/sh\n. ./hook-environment.sh\npnpm lint\n",
    '#!/bin/sh\nc"d" /private/tmp\npnpm lint\n',
  ])("requires manual setup after cwd-sensitive hook code", async (content) => {
    const fixture = await createFixture();
    await fixture.write(".git/hooks/pre-commit", content, 0o755);

    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });

    expect(plan).toMatchObject({ manager: "native", mode: "manual" });
    expect(plan.changes).toEqual([]);
  });

  it("sanitizes terminal controls in the confirmation preview", async () => {
    const fixture = await createFixture();
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });
    const preview = formatPreCommitInstallPlan({
      ...plan,
      command: `${plan.command}\u001B[2J`,
      reason: `${plan.reason}\nspoofed`,
    });

    expect(preview).not.toContain("\u001B");
    expect(preview).not.toContain("\nspoofed");
    expect(preview).toContain(" [2J");
    expect(preview).toContain(" spoofed");
  });

  it("detects a stale plan before writing", async () => {
    const fixture = await createFixture();
    const hookPath = await fixture.write(
      ".git/hooks/pre-commit",
      "#!/bin/sh\npnpm lint\n",
      0o755
    );
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });
    await writeFile(hookPath, "#!/bin/sh\npnpm test\n");

    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
    expect(await readFile(hookPath, "utf8")).toBe("#!/bin/sh\npnpm test\n");
  });

  it("detects hook-manager configuration added after planning", async () => {
    const fixture = await createFixture();
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });
    await fixture.write(
      "lefthook.yml",
      "pre-commit:\n  commands:\n    lint:\n      run: pnpm lint\n"
    );

    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).rejects.toMatchObject({ code: "STALE_PLAN" });
    await expect(
      readFile(path.join(fixture.hooksPath, "pre-commit"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a hooks parent replaced by an outside symlink", async () => {
    const fixture = await createFixture();
    const plan = await createPreCommitInstallPlan({
      ...fixture,
      packageManager: "pnpm",
      score: 92,
      version: "0.1.0",
    });
    const outsideHooks = await mkdtemp(
      path.join(tmpdir(), "shadscan-outside-hooks-")
    );
    temporaryDirectories.push(outsideHooks);
    await rm(fixture.hooksPath, { recursive: true });
    await symlink(outsideHooks, fixture.hooksPath, "dir");

    await expect(
      applyPreCommitInstallPlan(plan, { confirmed: true })
    ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });

  it("rejects non-numeric floors and non-exact versions", async () => {
    const fixture = await createFixture();

    await expect(
      createPreCommitInstallPlan({
        ...fixture,
        packageManager: "pnpm",
        score: 92.5,
        version: "0.1.0",
      })
    ).rejects.toMatchObject({ code: "INVALID_SCORE" });
    await expect(
      createPreCommitInstallPlan({
        ...fixture,
        packageManager: "pnpm",
        score: 92,
        version: "next",
      })
    ).rejects.toMatchObject({ code: "INVALID_VERSION" });
  });
});
