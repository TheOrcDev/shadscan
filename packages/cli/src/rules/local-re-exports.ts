import {
  isExportDeclaration,
  isNamedExports,
  isStringLiteral,
  type NamedExportBindings,
  type SourceFile,
} from "typescript";

interface ReExport {
  moduleName: string;
  names: Set<string>;
}
const selectedNames = (
  clause: NamedExportBindings | undefined,
  wanted: Set<string>
): Set<string> => {
  if (!clause) {
    return new Set(wanted);
  }
  const names = new Set<string>();
  if (!isNamedExports(clause)) {
    return names;
  }
  for (const element of clause.elements) {
    if (
      !element.isTypeOnly &&
      (wanted.has("*") || wanted.has(element.name.text))
    ) {
      names.add((element.propertyName ?? element.name).text);
    }
  }
  return names;
};
/** Follow only exported values actually requested by the importing consumer. */
export const getLocalReExports = (
  sourceFile: SourceFile,
  wantedNames: Set<string>
): ReExport[] => {
  const references: ReExport[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const names = selectedNames(statement.exportClause, wantedNames);
    if (names.size) {
      references.push({ moduleName: statement.moduleSpecifier.text, names });
    }
  }
  return references;
};
