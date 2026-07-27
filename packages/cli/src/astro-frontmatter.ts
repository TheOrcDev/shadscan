import {
  createSourceFile,
  isImportDeclaration,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
} from "typescript";

interface AstroFileParts {
  frontmatter: string | null;
  template: string;
}

interface AstroImportBinding {
  /** "default" for default imports, "*" for namespaces, else the source name. */
  importedName: string;
  localName: string;
  moduleSpecifier: string;
}

const FENCE = "---";

/**
 * Split an .astro source into its frontmatter (the TypeScript between the
 * leading `---` fences) and the template below. The template is never parsed
 * — it stays text for regex checks only.
 */
const splitAstroFile = (content: string): AstroFileParts => {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith(FENCE)) {
    return { frontmatter: null, template: content };
  }

  const afterOpen = trimmed.slice(FENCE.length);
  const closeIndex = afterOpen.indexOf(`\n${FENCE}`);

  if (closeIndex === -1) {
    return { frontmatter: null, template: content };
  }

  return {
    frontmatter: afterOpen.slice(0, closeIndex),
    template: afterOpen.slice(closeIndex + FENCE.length + 1),
  };
};

/**
 * Parse an .astro file's frontmatter as plain TypeScript (which it is, by
 * Astro's definition) and return its import bindings. Returns null when the
 * file has no parseable frontmatter — callers record a boundary reason
 * rather than guessing.
 */
const getAstroImportBindings = (
  filePath: string,
  content: string
): AstroImportBinding[] | null => {
  const { frontmatter } = splitAstroFile(content);

  if (frontmatter === null) {
    return null;
  }

  const sourceFile = createSourceFile(
    `${filePath}.frontmatter.ts`,
    frontmatter,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS
  );
  const bindings: AstroImportBinding[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    const importClause = statement.importClause;

    if (importClause?.name) {
      bindings.push({
        importedName: "default",
        localName: importClause.name.text,
        moduleSpecifier,
      });
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamespaceImport(namedBindings)) {
      bindings.push({
        importedName: "*",
        localName: namedBindings.name.text,
        moduleSpecifier,
      });
    } else if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.push({
          importedName: element.propertyName?.text ?? element.name.text,
          localName: element.name.text,
          moduleSpecifier,
        });
      }
    }
  }

  return bindings;
};

/** True when the template text renders `<Name` at least once. */
const templateRendersTag = (template: string, localName: string): boolean =>
  new RegExp(`<${localName}\\b`).test(template);

const isAstroFile = (filePath: string): boolean => filePath.endsWith(".astro");

export type { AstroFileParts, AstroImportBinding };
export {
  getAstroImportBindings,
  isAstroFile,
  splitAstroFile,
  templateRendersTag,
};
