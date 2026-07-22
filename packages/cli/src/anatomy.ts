import {
  isExportDeclaration,
  isFunctionDeclaration,
  isImportDeclaration,
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isJsxText,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  isVariableStatement,
  type JsxChild,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  visitJsxNodes,
} from "./ast";

const ICON_TAG_PATTERN = /(?:Icon$|^Icon(?:[A-Z0-9]|$)|^Spinner$)/;
const COMPONENT_TAG_PATTERN = /^[A-Z]/;
const WHITESPACE_ONLY_PATTERN = /^\s*$/;

interface UiModuleImports {
  locals: Map<string, string>;
  namespaces: Set<string>;
}

interface AnatomyContainerContract {
  contextComponent: string;
  groupComponent: string;
  itemComponent: string;
  moduleFile: string;
}

interface AnatomyForbiddenChild {
  component: string;
  moduleFile: string | null;
  nativeTag?: string;
  remediation: string;
}

interface ComponentAnatomyManifest {
  allowIcon: boolean;
  component: string;
  forbidden: AnatomyForbiddenChild[];
  moduleFile: string;
  requiredParts: string[];
}

interface AnatomyViolation {
  filePath: string;
  line: number;
  message: string;
  remediation: string;
}

interface AnatomyEvaluation {
  instances: number;
  uncertainInstances: number;
  violation: AnatomyViolation | null;
}

const escapeModuleFile = (moduleFile: string): string =>
  moduleFile.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isShadcnUiModule = (
  moduleName: string,
  uiAlias: string | undefined,
  moduleFile: string
): boolean => {
  const uiPathPattern = new RegExp(
    `(?:^|/)ui/(?:components/)?${escapeModuleFile(moduleFile)}$`
  );
  if (uiPathPattern.test(moduleName)) {
    return true;
  }

  if (!uiAlias) {
    return false;
  }

  const normalizedAlias = uiAlias.endsWith("/")
    ? uiAlias.slice(0, -1)
    : uiAlias;
  return moduleName === `${normalizedAlias}/${moduleFile}`;
};

const collectUiModuleImports = (
  sourceFile: SourceFile,
  uiAlias: string | undefined,
  moduleFile: string
): UiModuleImports => {
  const imports: UiModuleImports = {
    locals: new Map(),
    namespaces: new Set(),
  };

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        isShadcnUiModule(statement.moduleSpecifier.text, uiAlias, moduleFile)
      )
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }

    const bindings = importClause.namedBindings;
    if (bindings && isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.locals.set(
          element.name.text,
          element.propertyName?.text ?? element.name.text
        );
      }
    }
    if (bindings && isNamespaceImport(bindings)) {
      imports.namespaces.add(bindings.name.text);
    }
  }

  return imports;
};

const resolveUiTagName = (
  tagName: string,
  imports: UiModuleImports
): string | null => {
  const local = imports.locals.get(tagName);
  if (local) {
    return local;
  }

  const [namespace, member] = tagName.split(".");
  if (namespace && member && imports.namespaces.has(namespace)) {
    return member;
  }

  return null;
};

const hasImports = (imports: UiModuleImports): boolean =>
  imports.locals.size > 0 || imports.namespaces.size > 0;

const getOpeningElement = (node: Node): JsxOpeningLikeElement | null => {
  if (isJsxElement(node)) {
    return node.openingElement;
  }
  if (isJsxSelfClosingElement(node)) {
    return node;
  }
  return null;
};

const addExportedNames = (statement: Node, names: Set<string>): void => {
  const hasExportModifier =
    "modifiers" in statement &&
    Array.isArray(statement.modifiers) &&
    statement.modifiers.some(
      (modifier: { kind: SyntaxKind }) =>
        modifier.kind === SyntaxKind.ExportKeyword
    );

  if (isVariableStatement(statement) && hasExportModifier) {
    for (const declaration of statement.declarationList.declarations) {
      if ("text" in declaration.name) {
        names.add(String(declaration.name.text));
      }
    }
  }

  if (isFunctionDeclaration(statement) && hasExportModifier && statement.name) {
    names.add(statement.name.text);
  }

  if (
    isExportDeclaration(statement) &&
    statement.exportClause &&
    isNamedExports(statement.exportClause)
  ) {
    for (const element of statement.exportClause.elements) {
      names.add(element.name.text);
    }
  }
};

const collectModuleExportNames = (
  files: readonly ParsedSourceFile[],
  moduleFile: string
): Set<string> | null => {
  const modulePathPattern = new RegExp(
    `(?:^|/)ui/(?:components/)?${escapeModuleFile(moduleFile)}\\.(?:tsx|jsx|ts|js)$`
  );
  const moduleSource = files.find((file) =>
    modulePathPattern.test(file.filePath)
  );
  if (!moduleSource) {
    return null;
  }

  const names = new Set<string>();
  for (const statement of moduleSource.sourceFile.statements) {
    addExportedNames(statement, names);
  }
  return names;
};

const getMeaningfulChildren = (
  node: JsxElement
): { children: JsxChild[]; uncertain: boolean } => {
  const children: JsxChild[] = [];
  let uncertain = false;

  for (const child of node.children) {
    if (isJsxText(child)) {
      if (!WHITESPACE_ONLY_PATTERN.test(child.text)) {
        children.push(child);
      }
      continue;
    }

    if (isJsxExpression(child)) {
      uncertain = true;
      continue;
    }

    children.push(child);
  }

  return { children, uncertain };
};

type AncestorKind = "context" | "group" | "other" | "unknown-component";

const classifyAncestor = (
  ancestor: Node,
  contract: AnatomyContainerContract,
  imports: UiModuleImports
): AncestorKind => {
  const openingElement = getOpeningElement(ancestor);
  if (!openingElement) {
    return "other";
  }

  const tagName = getJsxTagName(openingElement);
  if (!tagName) {
    return "other";
  }

  const resolved = resolveUiTagName(tagName, imports);
  if (resolved === contract.groupComponent) {
    return "group";
  }
  if (resolved === contract.contextComponent) {
    return "context";
  }
  if (resolved === null && COMPONENT_TAG_PATTERN.test(tagName)) {
    return "unknown-component";
  }
  return "other";
};

const findContainerViolation = ({
  contract,
  file,
  imports,
  node,
}: {
  contract: AnatomyContainerContract;
  file: ParsedSourceFile;
  imports: UiModuleImports;
  node: Node;
}): { status: "ok" | "uncertain" | "violation"; line: number } => {
  let ancestor: Node | undefined = node.parent;
  let sawUnknownComponent = false;

  while (ancestor) {
    const kind = classifyAncestor(ancestor, contract, imports);
    if (kind === "group") {
      return { line: 0, status: "ok" };
    }
    if (kind === "context") {
      return sawUnknownComponent
        ? { line: 0, status: "uncertain" }
        : {
            line: getLineNumber(file, getOpeningElement(node) ?? node),
            status: "violation",
          };
    }
    if (kind === "unknown-component") {
      sawUnknownComponent = true;
    }
    ancestor = ancestor.parent;
  }

  return { line: 0, status: "uncertain" };
};

const evaluateContainerContract = (
  files: readonly ParsedSourceFile[],
  uiAlias: string | undefined,
  contract: AnatomyContainerContract
): AnatomyEvaluation => {
  const evaluation: AnatomyEvaluation = {
    instances: 0,
    uncertainInstances: 0,
    violation: null,
  };

  for (const file of files) {
    const imports = collectUiModuleImports(
      file.sourceFile,
      uiAlias,
      contract.moduleFile
    );
    if (!hasImports(imports)) {
      continue;
    }

    visitJsxNodes([file], ({ node }) => {
      const openingElement = getOpeningElement(node);
      if (!openingElement || evaluation.violation) {
        return;
      }

      const tagName = getJsxTagName(openingElement);
      const resolved = tagName ? resolveUiTagName(tagName, imports) : null;
      if (resolved !== contract.itemComponent) {
        return;
      }

      evaluation.instances += 1;
      const result = findContainerViolation({ contract, file, imports, node });

      if (result.status === "uncertain") {
        evaluation.uncertainInstances += 1;
      } else if (result.status === "violation") {
        evaluation.violation = {
          filePath: file.filePath,
          line: result.line,
          message: `${contract.itemComponent} sits directly inside ${contract.contextComponent} without a ${contract.groupComponent}.`,
          remediation: `Wrap ${contract.itemComponent} elements in a ${contract.groupComponent} inside ${contract.contextComponent}.`,
        };
      }
    });
  }

  return evaluation;
};

const evaluateContainerContracts = (
  files: readonly ParsedSourceFile[],
  uiAlias: string | undefined,
  contracts: readonly AnatomyContainerContract[]
): AnatomyEvaluation => {
  const combined: AnatomyEvaluation = {
    instances: 0,
    uncertainInstances: 0,
    violation: null,
  };

  for (const contract of contracts) {
    const evaluation = evaluateContainerContract(files, uiAlias, contract);
    combined.instances += evaluation.instances;
    combined.uncertainInstances += evaluation.uncertainInstances;
    combined.violation ??= evaluation.violation;
  }

  return combined;
};

const findForbiddenChild = ({
  child,
  forbidden,
  forbiddenImports,
}: {
  child: JsxChild;
  forbidden: readonly AnatomyForbiddenChild[];
  forbiddenImports: ReadonlyMap<string, UiModuleImports>;
}): AnatomyForbiddenChild | null => {
  const openingElement = getOpeningElement(child);
  if (!openingElement) {
    return null;
  }

  const tagName = getJsxTagName(openingElement);
  if (!tagName) {
    return null;
  }

  for (const entry of forbidden) {
    if (entry.nativeTag && tagName === entry.nativeTag) {
      return entry;
    }
    if (entry.moduleFile) {
      const imports = forbiddenImports.get(entry.moduleFile);
      if (imports && resolveUiTagName(tagName, imports) === entry.component) {
        return entry;
      }
    }
  }

  return null;
};

const classifyAnatomyChild = ({
  child,
  exportedParts,
  imports,
  manifest,
}: {
  child: JsxChild;
  exportedParts: Set<string> | null;
  imports: UiModuleImports;
  manifest: ComponentAnatomyManifest;
}): { kind: "icon" | "part" | "unknown" | "uncertain"; part?: string } => {
  const openingElement = getOpeningElement(child);
  if (!openingElement) {
    return { kind: "uncertain" };
  }

  const tagName = getJsxTagName(openingElement);
  if (!tagName) {
    return { kind: "uncertain" };
  }

  const resolved = resolveUiTagName(tagName, imports);
  if (resolved) {
    return { kind: "part", part: resolved };
  }

  if (manifest.allowIcon && ICON_TAG_PATTERN.test(tagName)) {
    return { kind: "icon" };
  }

  if (!COMPONENT_TAG_PATTERN.test(tagName)) {
    return { kind: "unknown" };
  }

  if (exportedParts === null) {
    return { kind: "uncertain" };
  }

  return exportedParts.has(tagName.split(".")[0] ?? tagName)
    ? { kind: "part", part: tagName }
    : { kind: "unknown" };
};

interface AnatomyChildScan {
  iconCount: number;
  sawUncertainChild: boolean;
  seenParts: Set<string>;
  violation: AnatomyViolation | null;
}

const toChildViolation = (
  child: JsxChild,
  file: ParsedSourceFile,
  manifest: ComponentAnatomyManifest,
  forbiddenEntry: AnatomyForbiddenChild | null
): AnatomyViolation => {
  const openingElement = getOpeningElement(child);
  const childTag = openingElement ? getJsxTagName(openingElement) : null;
  const line = getLineNumber(file, openingElement ?? child);

  if (forbiddenEntry) {
    return {
      filePath: file.filePath,
      line,
      message: `${manifest.component} contains ${forbiddenEntry.component}, which is not part of its anatomy.`,
      remediation: forbiddenEntry.remediation,
    };
  }

  return {
    filePath: file.filePath,
    line,
    message: `${manifest.component} contains ${childTag ?? "a child"} that is not part of its anatomy.`,
    remediation: `Compose ${manifest.component} from its own parts (${manifest.requiredParts.join(", ") || "its exported subcomponents"}) or extend the ui module with the new part.`,
  };
};

const scanAnatomyChildren = ({
  children,
  exportedParts,
  file,
  forbiddenImports,
  imports,
  manifest,
}: {
  children: readonly JsxChild[];
  exportedParts: Set<string> | null;
  file: ParsedSourceFile;
  forbiddenImports: ReadonlyMap<string, UiModuleImports>;
  imports: UiModuleImports;
  manifest: ComponentAnatomyManifest;
}): AnatomyChildScan => {
  const scan: AnatomyChildScan = {
    iconCount: 0,
    sawUncertainChild: false,
    seenParts: new Set(),
    violation: null,
  };

  for (const child of children) {
    const forbiddenEntry = findForbiddenChild({
      child,
      forbidden: manifest.forbidden,
      forbiddenImports,
    });
    if (forbiddenEntry) {
      scan.violation = toChildViolation(child, file, manifest, forbiddenEntry);
      return scan;
    }

    const classified = classifyAnatomyChild({
      child,
      exportedParts,
      imports,
      manifest,
    });
    if (classified.kind === "part" && classified.part) {
      scan.seenParts.add(classified.part);
    } else if (classified.kind === "icon") {
      scan.iconCount += 1;
    } else if (classified.kind === "uncertain") {
      scan.sawUncertainChild = true;
    } else {
      scan.violation = toChildViolation(child, file, manifest, null);
      return scan;
    }
  }

  return scan;
};

const evaluateAnatomyInstance = ({
  exportedParts,
  file,
  forbiddenImports,
  imports,
  manifest,
  node,
}: {
  exportedParts: Set<string> | null;
  file: ParsedSourceFile;
  forbiddenImports: ReadonlyMap<string, UiModuleImports>;
  imports: UiModuleImports;
  manifest: ComponentAnatomyManifest;
  node: JsxElement;
}): { uncertain: boolean; violation: AnatomyViolation | null } => {
  const { children, uncertain } = getMeaningfulChildren(node);
  const line = getLineNumber(file, node.openingElement);
  const scan = scanAnatomyChildren({
    children,
    exportedParts,
    file,
    forbiddenImports,
    imports,
    manifest,
  });

  if (scan.violation) {
    return { uncertain: false, violation: scan.violation };
  }

  if (scan.iconCount > 1) {
    return {
      uncertain: false,
      violation: {
        filePath: file.filePath,
        line,
        message: `${manifest.component} renders ${scan.iconCount} icons; its anatomy allows at most one.`,
        remediation: `Keep a single leading icon inside ${manifest.component}.`,
      },
    };
  }

  if (uncertain || scan.sawUncertainChild || children.length === 0) {
    return { uncertain: true, violation: null };
  }

  const missingPart = manifest.requiredParts.find(
    (part) => !scan.seenParts.has(part)
  );
  if (missingPart) {
    return {
      uncertain: false,
      violation: {
        filePath: file.filePath,
        line,
        message: `${manifest.component} is missing its required ${missingPart} part.`,
        remediation: `Add a ${missingPart} inside ${manifest.component}.`,
      },
    };
  }

  return { uncertain: false, violation: null };
};

const evaluateComponentAnatomy = (
  files: readonly ParsedSourceFile[],
  uiAlias: string | undefined,
  manifest: ComponentAnatomyManifest
): AnatomyEvaluation => {
  const evaluation: AnatomyEvaluation = {
    instances: 0,
    uncertainInstances: 0,
    violation: null,
  };
  const exportedParts = collectModuleExportNames(files, manifest.moduleFile);

  for (const file of files) {
    const imports = collectUiModuleImports(
      file.sourceFile,
      uiAlias,
      manifest.moduleFile
    );
    if (!hasImports(imports)) {
      continue;
    }

    const forbiddenImports = new Map<string, UiModuleImports>();
    for (const entry of manifest.forbidden) {
      if (entry.moduleFile && !forbiddenImports.has(entry.moduleFile)) {
        forbiddenImports.set(
          entry.moduleFile,
          collectUiModuleImports(file.sourceFile, uiAlias, entry.moduleFile)
        );
      }
    }

    visitJsxNodes([file], ({ node }) => {
      if (evaluation.violation || !isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node.openingElement);
      const resolved = tagName ? resolveUiTagName(tagName, imports) : null;
      if (resolved !== manifest.component) {
        return;
      }

      evaluation.instances += 1;
      const result = evaluateAnatomyInstance({
        exportedParts,
        file,
        forbiddenImports,
        imports,
        manifest,
        node,
      });

      if (result.violation) {
        evaluation.violation = result.violation;
      } else if (result.uncertain) {
        evaluation.uncertainInstances += 1;
      }
    });
  }

  return evaluation;
};

export type {
  AnatomyContainerContract,
  AnatomyEvaluation,
  AnatomyForbiddenChild,
  AnatomyViolation,
  ComponentAnatomyManifest,
};
export {
  collectModuleExportNames,
  collectUiModuleImports,
  evaluateComponentAnatomy,
  evaluateContainerContracts,
  isShadcnUiModule,
  resolveUiTagName,
};
