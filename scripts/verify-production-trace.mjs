import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
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

const toAbsoluteTracePath = (tracePath, tracedFile) =>
  path.resolve(path.dirname(path.resolve(tracePath)), tracedFile);

const toComparablePath = (filePath) => filePath.split(path.sep).join("/");

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
  const tracedPaths = trace.files.map((tracedFile) =>
    toAbsoluteTracePath(tracePath, tracedFile)
  );
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

process.stdout.write("Production traces contain only the scanner runtime.\n");
