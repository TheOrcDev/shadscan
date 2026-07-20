import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, "package.json"), "utf8")
);

const run = async (command, args, { cwd, expectedExitCode = 0 } = {}) => {
  const result = await execa(command, args, {
    cwd,
    env: { CI: "1", NO_COLOR: "1" },
    reject: false,
  });

  assert.equal(
    result.exitCode,
    expectedExitCode,
    [
      `Expected ${command} ${args.join(" ")} to exit ${expectedExitCode}, received ${result.exitCode}.`,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return result;
};

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "shadscan packed smoke ")
);

try {
  const packDirectory = path.join(temporaryRoot, "packed artifact");
  const consumerDirectory = path.join(temporaryRoot, "consumer project");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(path.join(consumerDirectory, "src"), { recursive: true }),
  ]);

  await run("npm", ["pack", "--pack-destination", packDirectory], {
    cwd: packageDirectory,
  });

  const tarballs = (await readdir(packDirectory)).filter((fileName) =>
    fileName.endsWith(".tgz")
  );
  assert.equal(tarballs.length, 1, "Expected exactly one packed tarball.");
  const tarballPath = path.join(packDirectory, tarballs[0]);
  const npxExecutable = process.platform === "win32" ? "npx.cmd" : "npx";

  const npxVersionResult = await run(
    npxExecutable,
    ["--yes", `--package=${tarballPath}`, "shadscan", "--version"],
    { cwd: packDirectory }
  );
  assert.equal(npxVersionResult.stdout.trim(), packageManifest.version);

  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "shadscan-smoke-consumer", private: true, type: "module" }, null, 2)}\n`
  );
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
    { cwd: consumerDirectory }
  );

  const consumerManifestPath = path.join(consumerDirectory, "package.json");
  const consumerManifest = JSON.parse(
    await readFile(consumerManifestPath, "utf8")
  );
  consumerManifest.dependencies = {
    ...consumerManifest.dependencies,
    react: "19.2.4",
  };
  await writeFile(
    consumerManifestPath,
    `${JSON.stringify(consumerManifest, null, 2)}\n`
  );
  await writeFile(
    path.join(consumerDirectory, "src", "App.tsx"),
    'export const App = () => <button type="button">Delete</button>;\n'
  );

  const executable = path.join(
    consumerDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "shadscan.cmd" : "shadscan"
  );
  const versionResult = await run(executable, ["--version"], {
    cwd: consumerDirectory,
  });
  assert.equal(versionResult.stdout.trim(), packageManifest.version);

  const jsonResult = await run(executable, ["--json"], {
    cwd: consumerDirectory,
  });
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.engineVersion, packageManifest.version);
  assert.equal(report.schemaVersion, 3);
  assert.ok(Array.isArray(report.agentHandoff.workItems));
  assert.equal(
    typeof report.agentHandoff.verification.shadscanCommand,
    "string"
  );
  assert.ok(Array.isArray(report.findings));
  assert.ok(report.score < 100);
  assert.ok(!jsonResult.stdout.includes(temporaryRoot));

  const explicitPathResult = await run(
    executable,
    [consumerDirectory, "--json"],
    { cwd: packDirectory }
  );
  assert.equal(
    JSON.parse(explicitPathResult.stdout).packageName,
    "shadscan-smoke-consumer"
  );

  const npxReportResult = await run(
    npxExecutable,
    [
      "--yes",
      `--package=${tarballPath}`,
      "shadscan",
      consumerDirectory,
      "--json",
    ],
    { cwd: packDirectory }
  );
  assert.equal(
    JSON.parse(npxReportResult.stdout).packageName,
    "shadscan-smoke-consumer"
  );

  const categoryResult = await run(
    executable,
    ["--json", "--category", "accessibility"],
    { cwd: consumerDirectory }
  );
  const categoryReport = JSON.parse(categoryResult.stdout);
  assert.deepEqual(categoryReport.scope.categories, ["accessibility"]);
  assert.ok(
    categoryReport.findings.every(
      (finding) => finding.category === "accessibility"
    )
  );

  const promptResult = await run(executable, ["--prompt"], {
    cwd: consumerDirectory,
  });
  assert.match(promptResult.stdout, /<shadscan-data/);
  assert.match(promptResult.stdout, /"acceptanceCriteria"/);
  assert.match(promptResult.stdout, /"promptVersion": 2/);
  assert.match(promptResult.stdout, /"workItems"/);

  const thresholdResult = await run(
    executable,
    ["--json", "--fail-under", "100"],
    { cwd: consumerDirectory, expectedExitCode: 1 }
  );
  assert.ok(JSON.parse(thresholdResult.stdout).score < 100);

  const importCheckPath = path.join(consumerDirectory, "verify-import.mjs");
  await writeFile(
    importCheckPath,
    [
      'import { AUDIT_REPORT_SCHEMA_VERSION, RULE_CATALOG, scanProject } from "@shadscan/cli";',
      'if (AUDIT_REPORT_SCHEMA_VERSION !== 3 || RULE_CATALOG.length !== 55 || typeof scanProject !== "function") {',
      '  throw new Error("The installed library exports are incomplete.");',
      "}",
      "",
    ].join("\n")
  );
  await run(process.execPath, [importCheckPath], { cwd: consumerDirectory });

  process.stdout.write(
    `Packed shadscan ${packageManifest.version} passed npx, install, bin, output, threshold, and import smoke tests.\n`
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
