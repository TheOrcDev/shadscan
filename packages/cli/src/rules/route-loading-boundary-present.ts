import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { fileExists, findFiles, getTextLineNumber } from "./source-files";

const ASYNC_ROUTE_PATTERN =
  /export\s+default\s+async\s+function|async\s+function\s+\w*(?:Page|Route)|\bawait\s+/;
const SUSPENSE_FALLBACK_PATTERN = /<Suspense\b[^>]*\bfallback=/;

const hasNearestLoadingFile = async (
  pagePath: string,
  appDir: string
): Promise<boolean> => {
  let currentDir = path.dirname(pagePath);
  const resolvedAppDir = path.resolve(appDir);

  while (currentDir.startsWith(resolvedAppDir)) {
    for (const extension of ["tsx", "jsx", "ts", "js"]) {
      if (await fileExists(path.join(currentDir, `loading.${extension}`))) {
        return true;
      }
    }

    if (currentDir === resolvedAppDir) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return false;
};

const routeLoadingBoundaryPresentRule: AuditRule = {
  adapters: ["next-app-router"],
  category: "states",
  confidence: "medium",
  description:
    "Checks async Next pages for a route loading file or inline Suspense fallback.",
  id: "route-loading-boundary-present",
  maxScore: 4,
  run: async ({ project }) => {
    const appDir = project.paths.appDir;

    if (!appDir) {
      return notApplicable("No Next App Router directory was found.");
    }

    const relativeAppDir = path.relative(project.rootDir, appDir);
    const pagePaths = await findFiles(project.rootDir, [
      path.join(relativeAppDir, "**/page.{js,jsx,ts,tsx}"),
      path.join(relativeAppDir, "page.{js,jsx,ts,tsx}"),
    ]);
    let asyncRouteCount = 0;

    for (const pagePath of pagePaths) {
      const content = await readFile(pagePath, "utf8");

      if (!ASYNC_ROUTE_PATTERN.test(content)) {
        continue;
      }

      asyncRouteCount += 1;

      if (
        SUSPENSE_FALLBACK_PATTERN.test(content) ||
        (await hasNearestLoadingFile(pagePath, appDir))
      ) {
        continue;
      }

      return fail(
        "Async route has no loading file or inline Suspense fallback.",
        "Add a loading.tsx boundary in the route segment or wrap async content in Suspense with a useful fallback.",
        {
          filePath: pagePath,
          line: getTextLineNumber(content, ASYNC_ROUTE_PATTERN),
          roast: "A blank screen is not suspense. It is a hostage situation.",
        }
      );
    }

    if (asyncRouteCount === 0) {
      return notApplicable(
        "No statically identifiable async Next pages were found."
      );
    }

    return pass(`All ${asyncRouteCount} async routes have loading coverage.`);
  },
  severity: "warning",
  title: "async routes have loading boundaries",
};

export { routeLoadingBoundaryPresentRule };
