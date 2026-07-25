import {
  getAstroImportBindings,
  isAstroFile,
  templateRendersTag,
} from "../astro-frontmatter";
import type { ProjectDiscovery } from "../discovery";
import { getProjectSourceFiles, type SourceFile } from "./source-files";

interface AstroMountedBinding {
  astroFilePath: string;
  localName: string;
  moduleSpecifier: string;
}

const HTML_ELEMENT_PATTERN = /<html\b/;

/** All owned .astro files, already budgeted and sorted by source discovery. */
const getAstroSourceFiles = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> =>
  (await getProjectSourceFiles(project)).filter((file) =>
    isAstroFile(file.path)
  );

/**
 * The Astro document shells: owned .astro files that render the <html>
 * element. Layouts are conventional, not enforced, so shells are found by
 * content rather than by path.
 */
const findAstroDocumentShells = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const astroFiles = await getAstroSourceFiles(project);
  return astroFiles.filter((file) => HTML_ELEMENT_PATTERN.test(file.content));
};

/**
 * Components an .astro file both imports (frontmatter, parsed as TS) and
 * renders as a tag in its template text. This is the island-mount signal:
 * imported-but-never-rendered bindings are excluded.
 */
const getAstroMountedBindings = async (
  project: ProjectDiscovery
): Promise<AstroMountedBinding[]> => {
  const astroFiles = await getAstroSourceFiles(project);
  const mounted: AstroMountedBinding[] = [];

  for (const file of astroFiles) {
    const bindings = getAstroImportBindings(file.path, file.content);

    if (!bindings) {
      continue;
    }

    for (const binding of bindings) {
      if (templateRendersTag(file.content, binding.localName)) {
        mounted.push({
          astroFilePath: file.path,
          localName: binding.localName,
          moduleSpecifier: binding.moduleSpecifier,
        });
      }
    }
  }

  return mounted;
};

export type { AstroMountedBinding };
export {
  findAstroDocumentShells,
  getAstroMountedBindings,
  getAstroSourceFiles,
};
