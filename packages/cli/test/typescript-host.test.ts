import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getParsedCommandLineOfConfigFile,
  resolveModuleName,
} from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { createConfinedTypeScriptHost } from "../src/typescript-host";

const cleanupPaths: string[] = [];

const createTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((cleanupPath) =>
      rm(cleanupPath, {
        force: true,
        recursive: true,
      })
    )
  );
});

describe("confined TypeScript host", () => {
  it("loads internal config inheritance without reading an external config", async () => {
    const sourceRoot = await createTemporaryDirectory("shadscan-ts-host-");
    const externalRoot = await createTemporaryDirectory(
      "shadscan-ts-external-"
    );
    await mkdir(path.join(sourceRoot, "config"), { recursive: true });
    await writeFile(
      path.join(sourceRoot, "config", "base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".." } })
    );
    await writeFile(
      path.join(externalRoot, "base.json"),
      JSON.stringify({ compilerOptions: { strict: true } })
    );
    const configPath = path.join(sourceRoot, "tsconfig.json");
    const host = createConfinedTypeScriptHost(sourceRoot);

    await writeFile(
      configPath,
      JSON.stringify({ extends: "./config/base.json" })
    );
    expect(
      getParsedCommandLineOfConfigFile(configPath, {}, host)?.options.baseUrl
    ).toBe(sourceRoot);

    await writeFile(
      configPath,
      JSON.stringify({ extends: path.join(externalRoot, "base.json") })
    );
    expect(
      getParsedCommandLineOfConfigFile(configPath, {}, host)?.options.strict
    ).toBeUndefined();
    expect(host.readFile(path.join(externalRoot, "base.json"))).toBeUndefined();
  });

  it("rejects external module targets and symlinks while resolving internal files", async () => {
    const sourceRoot = await createTemporaryDirectory("shadscan-ts-host-");
    const externalRoot = await createTemporaryDirectory(
      "shadscan-ts-external-"
    );
    const sourceDirectory = path.join(sourceRoot, "src");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, "inside.ts"), "export {};");
    await writeFile(path.join(externalRoot, "outside.ts"), "export {};");
    await symlink(
      path.join(externalRoot, "outside.ts"),
      path.join(sourceDirectory, "linked.ts")
    );
    const host = createConfinedTypeScriptHost(sourceRoot);
    const containingFile = path.join(sourceDirectory, "entry.ts");
    const compilerOptions = {
      baseUrl: sourceRoot,
      paths: {
        "@inside/*": ["src/*"],
        "@outside/*": [`${externalRoot}/*`],
      },
    };

    expect(
      resolveModuleName("@inside/inside", containingFile, compilerOptions, host)
        .resolvedModule?.resolvedFileName
    ).toBe(path.join(sourceDirectory, "inside.ts"));
    expect(
      resolveModuleName(
        "@outside/outside",
        containingFile,
        compilerOptions,
        host
      ).resolvedModule
    ).toBeUndefined();
    expect(host.fileExists(path.join(sourceDirectory, "linked.ts"))).toBe(
      false
    );
  });
});
