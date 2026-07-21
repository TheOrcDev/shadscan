import { spawnSync } from "node:child_process";
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
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const TRACE_PATHS = [
  ".next/server/app/scan/page.js.nft.json",
  ".next/server/app/v1/scans/route.js.nft.json",
];
const REQUIRED_RUNTIME_FILES = new Set([
  "packages/cli/LICENSE",
  "packages/cli/dist/index.js",
]);
const ALLOWED_PROJECT_FILES = new Set([
  "package.json",
  ...REQUIRED_RUNTIME_FILES,
]);
const NEXT_DIST_MARKER = "/node_modules/next/dist/";
const RUNTIME_REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
const projectRoot = process.cwd();
const sharedNextPackagePath = path.join(projectRoot, ".next/package.json");
const sharedServerChunksPath = path.join(projectRoot, ".next/server/chunks");
const tracedRuntimePaths = new Set();
const traceEntryPaths = [];

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

const copyTracedRuntime = async (sandboxRoot, sourcePaths) => {
  const entries = await Promise.all(
    [...sourcePaths].map(async (sourcePath) => ({
      sourcePath,
      stats: await lstat(sourcePath),
    }))
  );

  for (const { sourcePath, stats } of entries) {
    if (stats.isDirectory()) {
      await mkdir(toSandboxPath(sandboxRoot, sourcePath), { recursive: true });
    }
  }

  for (const { sourcePath, stats } of entries) {
    if (!stats.isSymbolicLink()) {
      continue;
    }

    const destinationPath = toSandboxPath(sandboxRoot, sourcePath);
    const sourceTarget = await readlink(sourcePath);
    const target = path.isAbsolute(sourceTarget)
      ? path.relative(path.dirname(sourcePath), sourceTarget)
      : sourceTarget;
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await symlink(target, destinationPath);
  }

  for (const { sourcePath, stats } of entries) {
    if (!stats.isFile()) {
      continue;
    }

    const destinationPath = toSandboxPath(sandboxRoot, sourcePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
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

for (const tracePath of TRACE_PATHS) {
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
  const missingRuntimeFiles = [...REQUIRED_RUNTIME_FILES].filter(
    (filePath) => !projectFiles.has(filePath)
  );
  const unrelatedFiles = [...projectFiles].filter(
    (filePath) => !ALLOWED_PROJECT_FILES.has(filePath)
  );
  const missingNextRuntimeFiles =
    await findMissingNextRuntimeFiles(tracedPaths);

  if (
    missingRuntimeFiles.length > 0 ||
    missingNextRuntimeFiles.length > 0 ||
    unrelatedFiles.length > 0
  ) {
    const details = [
      missingRuntimeFiles.length > 0
        ? `missing runtime: ${missingRuntimeFiles.join(", ")}`
        : null,
      missingNextRuntimeFiles.length > 0
        ? `missing Next runtime: ${missingNextRuntimeFiles.join(", ")}`
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
