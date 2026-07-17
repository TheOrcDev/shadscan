import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "shadscan";
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const REPOSITORY_URL = "git+https://github.com/TheOrcDev/headless-shadcn.git";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const UNPUBLISHED_COPY_PATTERN = /not published yet/i;
const FORBIDDEN_LIFECYCLE_SCRIPTS = ["install", "postinstall", "preinstall"];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const manifestPath = path.join(packageDirectory, "package.json");

const getOptionValue = (optionName) => {
  const optionIndex = process.argv.indexOf(optionName);

  if (optionIndex === -1) {
    return null;
  }

  const value = process.argv[optionIndex + 1];
  assert.ok(value, `Expected a value after ${optionName}.`);
  return value;
};

const getReleaseTag = () => {
  const tag = getOptionValue("--tag");

  if (tag === null) {
    return null;
  }

  assert.ok(tag === "latest" || tag === "next", "Expected --tag latest|next.");
  return tag;
};

const main = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const releaseTag = getReleaseTag();
  const gitTag = getOptionValue("--git-tag");
  const isPrerelease = manifest.version.includes("-");

  assert.equal(manifest.name, PACKAGE_NAME, "Unexpected npm package name.");
  assert.match(
    manifest.version,
    SEMVER_PATTERN,
    "Version must be valid semver."
  );
  assert.equal(manifest.license, "MIT", "The package license must remain MIT.");
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

  if (gitTag) {
    assert.equal(
      gitTag,
      `v${manifest.version}`,
      "The Git tag must match the package version."
    );

    const repositoryRoot = path.resolve(packageDirectory, "../..");
    const changelog = await readFile(
      path.join(repositoryRoot, "CHANGELOG.md"),
      "utf8"
    );
    const packageReadme = await readFile(
      path.join(packageDirectory, "README.md"),
      "utf8"
    );
    assert.ok(
      changelog.includes(`## ${manifest.version}`),
      "The changelog must contain the release version."
    );
    assert.doesNotMatch(
      packageReadme,
      UNPUBLISHED_COPY_PATTERN,
      "The published README cannot claim the package is unpublished."
    );
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
