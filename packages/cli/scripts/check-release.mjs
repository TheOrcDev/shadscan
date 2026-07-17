import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "shadscan";
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const REPOSITORY_URL = "git+https://github.com/TheOrcDev/headless-shadcn.git";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const FORBIDDEN_LIFECYCLE_SCRIPTS = ["install", "postinstall", "preinstall"];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const manifestPath = path.join(packageDirectory, "package.json");

const getReleaseTag = () => {
  const tagIndex = process.argv.indexOf("--tag");

  if (tagIndex === -1) {
    return null;
  }

  const tag = process.argv[tagIndex + 1];
  assert.ok(tag === "latest" || tag === "next", "Expected --tag latest|next.");
  return tag;
};

const main = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const releaseTag = getReleaseTag();
  const isPrerelease = manifest.version.includes("-");

  assert.equal(manifest.name, PACKAGE_NAME, "Unexpected npm package name.");
  assert.match(
    manifest.version,
    SEMVER_PATTERN,
    "Version must be valid semver."
  );
  assert.notEqual(
    manifest.license,
    "UNLICENSED",
    "Choose a public package license before release."
  );
  assert.equal(
    manifest.private,
    undefined,
    "The CLI package must be publishable."
  );
  assert.deepEqual(manifest.bin, { shadscan: "./dist/cli.js" });
  assert.ok(manifest.files.includes("dist"), "The tarball must include dist.");
  assert.ok(
    manifest.files.includes("LICENSE"),
    "The tarball must include LICENSE."
  );
  assert.ok(
    manifest.files.includes("README.md"),
    "The tarball must include README."
  );
  assert.equal(manifest.publishConfig?.access, "public");
  assert.equal(manifest.publishConfig?.registry, PUBLIC_REGISTRY);
  assert.equal(manifest.repository?.url, REPOSITORY_URL);
  assert.ok(manifest.engines?.node, "Declare the supported Node.js range.");

  for (const scriptName of FORBIDDEN_LIFECYCLE_SCRIPTS) {
    assert.equal(
      manifest.scripts?.[scriptName],
      undefined,
      `Do not publish a ${scriptName} lifecycle script.`
    );
  }

  for (const [dependencyName, dependencyVersion] of Object.entries(
    manifest.dependencies ?? {}
  )) {
    assert.ok(
      !String(dependencyVersion).startsWith("workspace:"),
      `${dependencyName} cannot use a workspace version in the published package.`
    );
  }

  if (releaseTag === "latest") {
    assert.equal(isPrerelease, false, "latest cannot point to a prerelease.");
  }

  if (releaseTag === "next") {
    assert.equal(isPrerelease, true, "next must publish a prerelease version.");
  }

  await access(path.join(packageDirectory, "LICENSE"));
  const cliSource = await readFile(
    path.join(packageDirectory, "dist", "cli.js"),
    "utf8"
  );
  assert.ok(
    cliSource.startsWith("#!/usr/bin/env node\n"),
    "The packaged CLI must start with the Node.js shebang."
  );

  process.stdout.write(
    `Shadscan ${manifest.version} is ready for the${releaseTag ? ` ${releaseTag}` : ""} release path.\n`
  );
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Release check failed: ${message}\n`);
  process.exitCode = 1;
}
