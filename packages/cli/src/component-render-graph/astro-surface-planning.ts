import path from "node:path";
import {
  getAstroImportBindings,
  isAstroFile,
  templateRendersTag,
} from "../astro-frontmatter";
import { compareCodeUnits } from "../deterministic-order";
import { findFiles, getProjectSourceFiles } from "../rules/source-files";
import { addSurfacePlan } from "./surface-plan-budget";
import { getRecordDefault, getRecordNamed } from "./symbol-resolution";
import type {
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  SurfacePlan,
} from "./types";

const ASTRO_FILE_EXTENSION_PATTERN = /\.astro$/;
const TRAILING_INDEX_SEGMENT_PATTERN = /(?:^|\/)index$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

interface AstroSourceLikeFile {
  content: string;
  path: string;
}

/**
 * Resolve one frontmatter import to a React component file record. Astro
 * files are not part of the TS module graph, so specifiers are resolved
 * relative to the .astro file (./ and ../) or through tsconfig-style `@/`
 * aliases against the project root — the two forms shadcn's Astro guide
 * produces. Anything else (bare packages, .astro imports) returns null.
 */
const resolveIslandRecord = (
  astroFilePath: string,
  moduleSpecifier: string,
  state: GraphBuildState
): FileRecord | null => {
  if (ASTRO_FILE_EXTENSION_PATTERN.test(moduleSpecifier)) {
    return null;
  }

  const candidates: string[] = [];

  if (moduleSpecifier.startsWith(".")) {
    candidates.push(path.resolve(path.dirname(astroFilePath), moduleSpecifier));
  } else if (moduleSpecifier.startsWith("@/")) {
    candidates.push(
      path.resolve(state.project.rootDir, "src", moduleSpecifier.slice(2)),
      path.resolve(state.project.rootDir, moduleSpecifier.slice(2))
    );
  } else if (moduleSpecifier.startsWith("~/")) {
    candidates.push(
      path.resolve(state.project.rootDir, "src", moduleSpecifier.slice(2))
    );
  } else {
    return null;
  }

  const suffixes = [
    "",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.tsx",
    "/index.ts",
  ];

  for (const candidate of candidates) {
    for (const suffix of suffixes) {
      const record = state.fileRecords.get(
        path.resolve(`${candidate}${suffix}`)
      );

      if (record) {
        return record;
      }
    }
  }

  return null;
};

const isUnderDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const getAstroRouteKey = (
  filePath: string,
  pagesDir: string,
  layoutsDir: string
): string => {
  if (isUnderDirectory(filePath, pagesDir)) {
    const relativePath = path
      .relative(pagesDir, filePath)
      .replace(ASTRO_FILE_EXTENSION_PATTERN, "")
      .split(path.sep)
      .join("/");
    const withoutIndex = relativePath.replace(
      TRAILING_INDEX_SEGMENT_PATTERN,
      ""
    );
    return `/${withoutIndex}`.replace(TRAILING_SLASHES_PATTERN, "") || "/";
  }

  return `layout:${path
    .relative(layoutsDir, filePath)
    .replace(ASTRO_FILE_EXTENSION_PATTERN, "")
    .split(path.sep)
    .join("/")}`;
};

const addAstroSurfacePlans = async (
  state: GraphBuildState,
  plans: SurfacePlan[]
): Promise<void> => {
  const pagesDir = state.project.paths.astroPagesDir;

  if (!pagesDir || state.surfacePlanningHalted) {
    return;
  }

  const layoutsDir = path.join(state.project.rootDir, "src", "layouts");
  const sourceFiles = await getProjectSourceFiles(state.project);
  const astroFiles: AstroSourceLikeFile[] = sourceFiles
    .filter(
      (file) =>
        isAstroFile(file.path) &&
        (isUnderDirectory(file.path, pagesDir) ||
          isUnderDirectory(file.path, layoutsDir))
    )
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  // Markdown pages are routes too, but carry no React surface; they are not
  // part of the scanned source set, so they are globbed directly.
  const mdxPages = await findFiles(state.project.rootDir, [
    "src/pages/**/*.{md,mdx}",
  ]);

  if (mdxPages.length > 0) {
    state.graphBoundaryReasons.add(
      "Markdown and MDX pages are not statically expanded into render surfaces."
    );
  }

  for (const astroFile of astroFiles) {
    const plan = collectAstroFilePlan(astroFile, state);

    if (plan.roots.length === 0 && plan.boundaryReasons.length === 0) {
      continue;
    }

    const routeKey = getAstroRouteKey(astroFile.path, pagesDir, layoutsDir);
    const added = addSurfacePlan(state, plans, {
      adapter: "astro-react",
      boundaryReasons: plan.boundaryReasons,
      dynamicComponent: null,
      id: `astro:${routeKey}`,
      roots: plan.roots,
      routeKey,
    });

    if (!added) {
      return;
    }
  }
};

const collectAstroFilePlan = (
  astroFile: AstroSourceLikeFile,
  state: GraphBuildState
): { boundaryReasons: string[]; roots: ComponentSeed[] } => {
  const bindings = getAstroImportBindings(astroFile.path, astroFile.content);
  const boundaryReasons: string[] = [];
  const roots: ComponentSeed[] = [];
  const relativePath = path.relative(state.project.rootDir, astroFile.path);

  if (bindings === null) {
    boundaryReasons.push(
      `The Astro file ${relativePath} has no parseable frontmatter.`
    );
  }

  for (const binding of bindings ?? []) {
    if (!templateRendersTag(astroFile.content, binding.localName)) {
      continue;
    }

    const record = resolveIslandRecord(
      astroFile.path,
      binding.moduleSpecifier,
      state
    );

    if (!record) {
      // .astro-to-.astro composition and package imports are expected;
      // only project-local React imports resolve through the candidates.
      continue;
    }

    if (binding.importedName === "*") {
      boundaryReasons.push(
        `Namespace island import ${binding.localName} in ${relativePath} is not statically expanded.`
      );
      continue;
    }

    const node =
      binding.importedName === "default"
        ? getRecordDefault(record, state)
        : getRecordNamed(record, binding.importedName, state);

    if (!node) {
      boundaryReasons.push(
        `Island ${binding.localName} in ${relativePath} has no resolvable component export named ${binding.importedName}.`
      );
      continue;
    }

    roots.push({ componentId: node.id, projectedChildren: null });
  }

  return { boundaryReasons, roots };
};

export { addAstroSurfacePlans };
