import { spawnSync } from "node:child_process";
import { once as onceEvent } from "node:events";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const HOSTED_SCANNER_RUNTIME_FILES = new Set([
  ".shadscan-runtime/index.js",
  "lib/shadscan-api/hosted-scan-worker.mjs",
  "packages/cli/LICENSE",
  "packages/cli/dist/index.js",
]);
const TRACE_TARGETS = [
  {
    requiredRuntimeFiles: HOSTED_SCANNER_RUNTIME_FILES,
    tracePath: ".next/server/app/scan/page.js.nft.json",
  },
  {
    requiredRuntimeFiles: HOSTED_SCANNER_RUNTIME_FILES,
    tracePath: ".next/server/app/v1/scans/route.js.nft.json",
  },
];
const NEXT_DIST_MARKER = "/node_modules/next/dist/";
const RUNTIME_REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const SCANNER_DEPENDENCY_SYMLINK_PATTERN =
  /(?:\/packages\/cli\/node_modules\/|\/node_modules\/\.pnpm\/(?:fdir|tinyglobby)@[^/]+\/node_modules\/(?:fdir|picomatch|tinyglobby)$)/;
const projectRoot = process.cwd();
const sharedNextPackagePath = path.join(projectRoot, ".next/package.json");
const sharedServerChunksPath = path.join(projectRoot, ".next/server/chunks");
const tracedRuntimePaths = new Set();
const traceEntryPaths = [];
const HOSTED_SCAN_WORKER_PATH = path.join(
  projectRoot,
  "lib/shadscan-api/hosted-scan-worker.mjs"
);
const SHADSCAN_CLI_RUNTIME_PATH = path.join(
  projectRoot,
  ".shadscan-runtime/index.js"
);

const toAbsoluteTracePath = (tracePath, tracedFile) =>
  path.resolve(path.dirname(path.resolve(tracePath)), tracedFile);

const toComparablePath = (filePath) => filePath.split(path.sep).join("/");

const toSandboxPath = (sandboxRoot, sourcePath) => {
  const relativePath = path.relative(projectRoot, sourcePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Trace escaped the project root: ${sourcePath}`);
  }
  return path.join(sandboxRoot, relativePath);
};

const toRealPath = async (filePath) => {
  try {
    return await realpath(filePath);
  } catch {
    return filePath;
  }
};

const isNextDistPath = (filePath) =>
  toComparablePath(filePath).includes(NEXT_DIST_MARKER);

const resolveNextRuntimeDependency = async (modulePath, specifier) => {
  const isPackageInternal =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("next/");

  if (!isPackageInternal) {
    return null;
  }

  try {
    const resolvedPath = createRequire(modulePath).resolve(specifier);
    const realPath = await toRealPath(resolvedPath);
    return isNextDistPath(realPath) ? realPath : null;
  } catch {
    return null;
  }
};

const getNextRuntimeDependencies = async (modulePath) => {
  const source = await readFile(modulePath, "utf8");
  const specifiers = [...source.matchAll(RUNTIME_REQUIRE_PATTERN)].map(
    (match) => match[1]
  );
  const dependencies = await Promise.all(
    specifiers.map((specifier) =>
      resolveNextRuntimeDependency(modulePath, specifier)
    )
  );
  return dependencies.filter(Boolean);
};

const findMissingNextRuntimeFiles = async (tracedPaths) => {
  const tracedRealPaths = await Promise.all(tracedPaths.map(toRealPath));
  const comparableTracePaths = new Set(tracedRealPaths.map(toComparablePath));
  const nextRuntimeModules = tracedRealPaths.filter(
    (filePath) => isNextDistPath(filePath) && filePath.endsWith(".js")
  );
  const requiredPaths = new Set(
    (
      await Promise.all(nextRuntimeModules.map(getNextRuntimeDependencies))
    ).flat()
  );

  return [...requiredPaths]
    .map(toComparablePath)
    .filter((filePath) => !comparableTracePaths.has(filePath))
    .map((filePath) => {
      const relativePath = filePath.split(NEXT_DIST_MARKER)[1];
      return `next/dist/${relativePath}`;
    })
    .sort();
};

const findScannerDependencySymlinks = async (tracedPaths) => {
  const candidates = tracedPaths.filter((filePath) =>
    SCANNER_DEPENDENCY_SYMLINK_PATTERN.test(toComparablePath(filePath))
  );
  const entries = await Promise.all(
    candidates.map(async (filePath) => ({
      filePath,
      stats: await lstat(filePath),
    }))
  );

  return entries
    .filter(({ stats }) => stats.isSymbolicLink())
    .map(({ filePath }) => path.relative(projectRoot, filePath))
    .map(toComparablePath)
    .sort();
};

const copyTracedRuntime = async (sandboxRoot, sourcePaths) => {
  const entries = await Promise.all(
    [...sourcePaths].map(async (sourcePath) => ({
      destinationPath: toSandboxPath(sandboxRoot, sourcePath),
      sourcePath,
      stats: await lstat(sourcePath),
    }))
  );
  const symlinkDestinations = entries
    .filter(({ stats }) => stats.isSymbolicLink())
    .map(({ destinationPath }) => destinationPath);
  const isInsideTracedSymlink = (destinationPath) =>
    symlinkDestinations.some((symlinkPath) => {
      const relativePath = path.relative(symlinkPath, destinationPath);
      return (
        relativePath.length > 0 &&
        !relativePath.startsWith("..") &&
        !path.isAbsolute(relativePath)
      );
    });

  for (const { destinationPath, stats } of entries) {
    if (stats.isDirectory() && !isInsideTracedSymlink(destinationPath)) {
      await mkdir(destinationPath, { recursive: true });
    }
  }

  for (const { destinationPath, sourcePath, stats } of entries) {
    if (!(stats.isFile() && !isInsideTracedSymlink(destinationPath))) {
      continue;
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  for (const { destinationPath, sourcePath, stats } of entries) {
    if (!stats.isSymbolicLink()) {
      continue;
    }

    const sourceTarget = await readlink(sourcePath);
    const target = path.isAbsolute(sourceTarget)
      ? path.relative(path.dirname(sourcePath), sourceTarget)
      : sourceTarget;
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await symlink(target, destinationPath);
  }
};

const smokeTraceEntries = async (entryPaths, sourcePaths) => {
  const sandboxRoot = await mkdtemp(
    path.join(tmpdir(), "shadscan-production-trace-")
  );

  try {
    await copyTracedRuntime(sandboxRoot, sourcePaths);
    await cp(
      sharedServerChunksPath,
      toSandboxPath(sandboxRoot, sharedServerChunksPath),
      { recursive: true }
    );
    await copyFile(
      sharedNextPackagePath,
      toSandboxPath(sandboxRoot, sharedNextPackagePath)
    );

    for (const sourceEntryPath of entryPaths) {
      const entryPath = toSandboxPath(sandboxRoot, sourceEntryPath);
      const result = spawnSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(entryPath)})`],
        {
          cwd: sandboxRoot,
          encoding: "utf8",
          env: { ...process.env, NODE_ENV: "production" },
        }
      );

      if (result.status !== 0) {
        const detail = (
          result.stderr ||
          result.stdout ||
          "Unknown error"
        ).trim();
        throw new Error(
          `${path.relative(projectRoot, sourceEntryPath)} failed in an isolated trace: ${detail}`
        );
      }
    }

    const workerFixturePath = path.join(sandboxRoot, "worker-fixture");
    await mkdir(path.join(workerFixturePath, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workerFixturePath, "package.json"),
        `${JSON.stringify({
          dependencies: { react: "19.2.4" },
          name: "trace-worker-fixture",
        })}\n`
      ),
      writeFile(
        path.join(workerFixturePath, "src/App.tsx"),
        "export const App = () => <main>Trace worker fixture</main>;\n"
      ),
    ]);

    const worker = new Worker(
      toSandboxPath(sandboxRoot, HOSTED_SCAN_WORKER_PATH),
      {
        env: { NODE_ENV: "production" },
        execArgv: [],
        resourceLimits: {
          maxOldGenerationSizeMb: 192,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
        workerData: {
          cliModuleUrl: pathToFileURL(
            toSandboxPath(sandboxRoot, SHADSCAN_CLI_RUNTIME_PATH)
          ).href,
          input: {
            filesystemRoot: workerFixturePath,
            projectRoot: workerFixturePath,
            source: {
              digest: `sha256:${"a".repeat(64)}`,
              kind: "snapshot",
              revision: null,
            },
          },
          operation: "scan",
        },
      }
    );
    try {
      const [message] = await onceEvent(worker, "message", {
        signal: AbortSignal.timeout(5000),
      });
      if (
        message === null ||
        typeof message !== "object" ||
        message.type !== "completed" ||
        message.report === null ||
        typeof message.report !== "object" ||
        message.report.packageName !== "trace-worker-fixture"
      ) {
        throw new Error("Hosted scan worker failed its isolated trace scan.");
      }
    } finally {
      await worker.terminate();
    }
  } finally {
    await rm(sandboxRoot, { force: true, recursive: true });
  }
};

const toProjectPath = (tracePath, tracedFile) => {
  const traceDirectory = path.dirname(path.resolve(tracePath));
  const absolutePath = path.resolve(traceDirectory, tracedFile);
  const relativePath = path.relative(process.cwd(), absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  if (
    relativePath.startsWith(".next/") ||
    relativePath.includes("/node_modules/") ||
    relativePath.startsWith("node_modules/")
  ) {
    return null;
  }

  return relativePath.split(path.sep).join("/");
};

for (const { requiredRuntimeFiles, tracePath } of TRACE_TARGETS) {
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const entryPath = path.resolve(tracePath.replace(/\.nft\.json$/, ""));
  const tracedPaths = trace.files.map((tracedFile) =>
    toAbsoluteTracePath(tracePath, tracedFile)
  );
  traceEntryPaths.push(entryPath);
  tracedRuntimePaths.add(entryPath);
  for (const tracedPath of tracedPaths) {
    tracedRuntimePaths.add(tracedPath);
  }
  const projectFiles = new Set(
    trace.files
      .map((tracedFile) => toProjectPath(tracePath, tracedFile))
      .filter(Boolean)
  );
  const missingRuntimeFiles = [...requiredRuntimeFiles].filter(
    (filePath) => !projectFiles.has(filePath)
  );
  const allowedProjectFiles = new Set([
    "package.json",
    ...requiredRuntimeFiles,
  ]);
  const unrelatedFiles = [...projectFiles].filter(
    (filePath) => !allowedProjectFiles.has(filePath)
  );
  const missingNextRuntimeFiles =
    await findMissingNextRuntimeFiles(tracedPaths);
  const scannerDependencySymlinks =
    await findScannerDependencySymlinks(tracedPaths);

  if (
    missingRuntimeFiles.length > 0 ||
    missingNextRuntimeFiles.length > 0 ||
    scannerDependencySymlinks.length > 0 ||
    unrelatedFiles.length > 0
  ) {
    const details = [
      missingRuntimeFiles.length > 0
        ? `missing runtime: ${missingRuntimeFiles.join(", ")}`
        : null,
      missingNextRuntimeFiles.length > 0
        ? `missing Next runtime: ${missingNextRuntimeFiles.join(", ")}`
        : null,
      scannerDependencySymlinks.length > 0
        ? `scanner dependency symlinks: ${scannerDependencySymlinks.join(", ")}`
        : null,
      unrelatedFiles.length > 0
        ? `unrelated source: ${unrelatedFiles.join(", ")}`
        : null,
    ].filter(Boolean);
    throw new Error(`${tracePath} is invalid (${details.join("; ")}).`);
  }
}

await smokeTraceEntries(traceEntryPaths, tracedRuntimePaths);

process.stdout.write(
  "Production traces contain only the scanner runtime and load in isolation.\n"
);
