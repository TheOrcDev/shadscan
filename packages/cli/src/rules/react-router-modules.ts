import path from "node:path";
import type { ProjectDiscovery } from "../discovery";
import { getProjectSourceFiles, type SourceFile } from "./source-files";

/** `export function ErrorBoundary` / `export const ErrorBoundary =`. */
const ERROR_BOUNDARY_EXPORT_PATTERN =
  /export\s+(?:async\s+)?(?:function\s+ErrorBoundary\b|const\s+ErrorBoundary\s*[=:])/;
/** React Router's documented 404 discriminator inside an ErrorBoundary. */
const ROUTE_ERROR_RESPONSE_PATTERN = /\bisRouteErrorResponse\s*\(/;
/** `export function HydrateFallback` / `export const HydrateFallback =`. */
const HYDRATE_FALLBACK_EXPORT_PATTERN =
  /export\s+(?:async\s+)?(?:function\s+HydrateFallback\b|const\s+HydrateFallback\s*[=:])/;
/** `export function meta` / `export const meta =`. */
const META_EXPORT_PATTERN =
  /export\s+(?:async\s+)?(?:function\s+meta\b|const\s+meta\s*[=:])/;
/** `export async function loader` / `export const loader =`, and clientLoader. */
const LOADER_EXPORT_PATTERN =
  /export\s+(?:async\s+)?(?:function\s+(?:client)?[Ll]oader\b|const\s+(?:client)?[Ll]oader\s*[=:])/;
const USE_NAVIGATION_PATTERN = /\buseNavigation\s*\(/;
const ROUTE_MODULE_EXTENSION_PATTERN = /\.[jt]sx$/;

const isReactRouterFramework = (project: ProjectDiscovery): boolean =>
  project.framework.adapter === "react-router-framework";

const isUnderDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

/** Every owned source file under the framework-mode `app/` directory. */
const getReactRouterAppFiles = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const appDir = project.paths.reactRouterAppDir;

  if (!appDir) {
    return [];
  }

  return (await getProjectSourceFiles(project)).filter(
    (file) =>
      ROUTE_MODULE_EXTENSION_PATTERN.test(file.path) &&
      isUnderDirectory(file.path, appDir)
  );
};

/** Route modules: everything under `app/` except the root document itself. */
const getReactRouterRouteModules = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const rootModule = project.paths.reactRouterRoot;

  return (await getReactRouterAppFiles(project)).filter(
    (file) => file.path !== rootModule
  );
};

export {
  ERROR_BOUNDARY_EXPORT_PATTERN,
  getReactRouterAppFiles,
  getReactRouterRouteModules,
  HYDRATE_FALLBACK_EXPORT_PATTERN,
  isReactRouterFramework,
  isUnderDirectory,
  LOADER_EXPORT_PATTERN,
  META_EXPORT_PATTERN,
  ROUTE_ERROR_RESPONSE_PATTERN,
  USE_NAVIGATION_PATTERN,
};
