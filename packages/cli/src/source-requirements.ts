const CONTENT_EXTENSIONS = new Set([
  ".astro",
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
// Laravel's Blade root view and error pages are read as text by document
// rules; retaining only resources/views keeps arbitrary PHP out of scope.
const BLADE_VIEW_PATTERN = /(?:^|\/)resources\/views\/.+\.blade\.php$/i;
const SCAN_SOURCE_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 10_000,
  maxTotalBytes: 50 * 1024 * 1024,
} as const;
const PACKAGE_MANAGER_MARKERS = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);
const PRESENCE_FILE_PATTERN =
  /(?:^|\/)(?:(?:src\/)?app\/(?:.*\/)?(?:apple-icon|favicon|icon|opengraph-image|twitter-image)\.[^/]+|public\/(?:favicon\.ico|icon\.[^/]+|robots\.txt|sitemap\.xml))$/i;

type ScanInputRetention = "content" | "ignore" | "presence";

const getExtension = (filePath: string): string => {
  const fileName = filePath.split("/").at(-1) ?? "";
  const extensionIndex = fileName.lastIndexOf(".");
  return extensionIndex > 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
};

const classifyScanInputPath = (
  repositoryRelativePath: string
): ScanInputRetention => {
  const normalizedPath = repositoryRelativePath.toLowerCase();
  const fileName = normalizedPath.split("/").at(-1) ?? "";

  if (PACKAGE_MANAGER_MARKERS.has(fileName)) {
    return "presence";
  }

  if (CONTENT_EXTENSIONS.has(getExtension(normalizedPath))) {
    return "content";
  }

  if (BLADE_VIEW_PATTERN.test(normalizedPath)) {
    return "content";
  }

  if (PRESENCE_FILE_PATTERN.test(normalizedPath) || fileName === "artisan") {
    return "presence";
  }

  return "ignore";
};

export type { ScanInputRetention };
export { classifyScanInputPath, SCAN_SOURCE_LIMITS };
