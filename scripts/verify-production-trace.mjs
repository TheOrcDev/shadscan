import { readFile } from "node:fs/promises";
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

  if (missingRuntimeFiles.length > 0 || unrelatedFiles.length > 0) {
    const details = [
      missingRuntimeFiles.length > 0
        ? `missing runtime: ${missingRuntimeFiles.join(", ")}`
        : null,
      unrelatedFiles.length > 0
        ? `unrelated source: ${unrelatedFiles.join(", ")}`
        : null,
    ].filter(Boolean);
    throw new Error(`${tracePath} is invalid (${details.join("; ")}).`);
  }
}

process.stdout.write("Production traces contain only the scanner runtime.\n");
