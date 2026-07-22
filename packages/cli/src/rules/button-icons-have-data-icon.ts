import {
  type ImportClause,
  isImportDeclaration,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isJsxSpreadAttribute,
  isJsxText,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  type JsxChild,
  type JsxElement,
  type JsxOpeningLikeElement,
  type SourceFile,
} from "typescript";
import {
  type EvidenceState,
  getAccessibleTextState,
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, notApplicable, pass } from "./rule-result";

type InlinePosition = "inline-end" | "inline-start";

interface ImportedComponents {
  names: Set<string>;
  namespaces: Set<string>;
}

interface IconCandidate {
  childIndex: number;
  openingElement: JsxOpeningLikeElement;
  tagName: string;
}

interface ButtonEvaluation {
  inlineIconCount: number;
  result: AuditRuleResult | null;
}

interface ContentPositions {
  indexes: number[];
  isDynamic: boolean;
}

const ICON_COMPONENT_NAME_PATTERN = /(?:Icon$|^Icon(?:[A-Z0-9]|$)|^Spinner$)/;
const VISUALLY_HIDDEN_COMPONENT_PATTERN =
  /^(?:ScreenReaderOnly|VisuallyHidden)$/;
const WHITESPACE_PATTERN = /\s+/;
const ICON_MODULE_PATTERNS = [
  /^@fortawesome\/react-fontawesome$/,
  /^@heroicons\/react(?:\/|$)/,
  /^@hugeicons\/react$/,
  /^@phosphor-icons\/react$/,
  /^@radix-ui\/react-icons$/,
  /^@tabler\/icons-react$/,
  /^hugeicons-react$/,
  /^iconoir-react$/,
  /^lucide-react$/,
  /^react-icons(?:\/|$)/,
];
const SHADCN_BUTTON_MODULE_PATTERN = /(?:^|\/)ui\/(?:components\/)?button$/;

const addImportedComponents = ({
  components,
  importClause,
  importedName,
}: {
  components: ImportedComponents;
  importClause: ImportClause;
  importedName?: string;
}): void => {
  if (importClause.name && !importedName) {
    components.names.add(importClause.name.text);
  }

  const namedBindings = importClause.namedBindings;
  if (!namedBindings) {
    return;
  }

  if (isNamespaceImport(namedBindings)) {
    if (importedName) {
      components.names.add(`${namedBindings.name.text}.${importedName}`);
    } else {
      components.namespaces.add(namedBindings.name.text);
    }
    return;
  }

  if (!isNamedImports(namedBindings)) {
    return;
  }

  for (const element of namedBindings.elements) {
    const sourceName = element.propertyName?.text ?? element.name.text;
    if (!importedName || sourceName === importedName) {
      components.names.add(element.name.text);
    }
  }
};

const getImportedComponents = (
  sourceFile: SourceFile,
  matchesModule: (moduleName: string) => boolean,
  importedName?: string
): ImportedComponents => {
  const components: ImportedComponents = {
    names: new Set<string>(),
    namespaces: new Set<string>(),
  };

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        matchesModule(statement.moduleSpecifier.text) &&
        statement.importClause
      )
    ) {
      continue;
    }

    addImportedComponents({
      components,
      importClause: statement.importClause,
      importedName,
    });
  }

  return components;
};

const isIconModule = (moduleName: string): boolean =>
  ICON_MODULE_PATTERNS.some((pattern) => pattern.test(moduleName));

const isShadcnButtonModule = (
  moduleName: string,
  uiAlias: string | undefined
): boolean => {
  if (SHADCN_BUTTON_MODULE_PATTERN.test(moduleName)) {
    return true;
  }

  if (!uiAlias) {
    return false;
  }

  const normalizedAlias = uiAlias.endsWith("/")
    ? uiAlias.slice(0, -1)
    : uiAlias;
  return moduleName === `${normalizedAlias}/button`;
};

const isImportedComponent = (
  tagName: string,
  components: ImportedComponents
): boolean => {
  if (components.names.has(tagName)) {
    return true;
  }

  const namespace = tagName.split(".")[0];
  return Boolean(namespace && components.namespaces.has(namespace));
};

const getOpeningElement = (child: JsxChild): JsxOpeningLikeElement | null => {
  if (isJsxElement(child)) {
    return child.openingElement;
  }

  return isJsxSelfClosingElement(child) ? child : null;
};

const flattenFragments = (children: readonly JsxChild[]): JsxChild[] => {
  const flattened: JsxChild[] = [];

  for (const child of children) {
    if (isJsxFragment(child)) {
      flattened.push(...flattenFragments(child.children));
    } else {
      flattened.push(child);
    }
  }

  return flattened;
};

const isEmptyJsxChild = (child: JsxChild): boolean =>
  (isJsxText(child) && child.getText().trim().length === 0) ||
  (isJsxExpression(child) && !child.expression);

const isVisuallyHidden = (node: JsxOpeningLikeElement): boolean => {
  const tagName = getJsxTagName(node)?.split(".").at(-1);
  if (tagName && VISUALLY_HIDDEN_COMPONENT_PATTERN.test(tagName)) {
    return true;
  }

  const hidden = getJsxAttributeValue(node, "hidden");
  if (hidden.kind === "static" && hidden.value === true) {
    return true;
  }

  const className = getJsxAttributeValue(node, "className");
  if (className.kind !== "static" || typeof className.value !== "string") {
    return false;
  }

  const classNames = className.value.split(WHITESPACE_PATTERN);
  const restoresScreenReaderOnlyContent = classNames.some(
    (name) => name === "not-sr-only" || name.endsWith(":not-sr-only")
  );

  return classNames.includes("sr-only") && !restoresScreenReaderOnlyContent;
};

const getVisibleTextState = (children: readonly JsxChild[]): EvidenceState => {
  let hasUnknownText = false;

  for (const child of children) {
    let textState: EvidenceState;

    if (isJsxElement(child)) {
      textState = isVisuallyHidden(child.openingElement)
        ? "invalid"
        : getVisibleTextState(child.children);
    } else if (isJsxFragment(child)) {
      textState = getVisibleTextState(child.children);
    } else {
      textState = getAccessibleTextState([child]);
    }

    if (textState === "valid") {
      return "valid";
    }

    if (textState === "unknown") {
      hasUnknownText = true;
    }
  }

  return hasUnknownText ? "unknown" : "invalid";
};

const getButtonChildren = (node: JsxElement): JsxChild[] => {
  const children = flattenFragments(node.children);
  const asChild = getJsxAttributeValue(node.openingElement, "asChild");

  if (!(asChild.kind === "static" && asChild.value === true)) {
    return children;
  }

  const renderedChildren = children.filter((child) => !isEmptyJsxChild(child));
  const slottedChild = renderedChildren[0];

  return renderedChildren.length === 1 &&
    slottedChild &&
    isJsxElement(slottedChild)
    ? flattenFragments(slottedChild.children)
    : children;
};

const getIconCandidates = (
  children: readonly JsxChild[],
  importedIcons: ImportedComponents
): IconCandidate[] => {
  const icons: IconCandidate[] = [];

  for (const [childIndex, child] of children.entries()) {
    const openingElement = getOpeningElement(child);
    if (!openingElement) {
      continue;
    }

    const tagName = getJsxTagName(openingElement);
    const shortTagName = tagName?.split(".").at(-1) ?? null;
    const isIcon = Boolean(
      tagName &&
        shortTagName &&
        (tagName === "svg" ||
          ICON_COMPONENT_NAME_PATTERN.test(shortTagName) ||
          isImportedComponent(tagName, importedIcons) ||
          getJsxAttributeValue(openingElement, "data-icon").kind !== "absent")
    );

    if (isIcon && tagName) {
      icons.push({ childIndex, openingElement, tagName });
    }
  }

  return icons;
};

const getExpectedPosition = (
  iconIndex: number,
  contentIndexes: number[]
): InlinePosition | null => {
  const firstContentIndex = contentIndexes[0];
  const lastContentIndex = contentIndexes.at(-1);

  if (firstContentIndex === undefined || lastContentIndex === undefined) {
    return null;
  }

  if (iconIndex < firstContentIndex) {
    return "inline-start";
  }

  return iconIndex > lastContentIndex ? "inline-end" : null;
};

const hasSpreadAttribute = (node: JsxOpeningLikeElement): boolean =>
  node.attributes.properties.some((property) => isJsxSpreadAttribute(property));

const evaluateIcon = ({
  expectedPosition,
  file,
  icon,
}: {
  expectedPosition: InlinePosition | null;
  file: ParsedSourceFile;
  icon: IconCandidate;
}): AuditRuleResult | null => {
  const dataIcon = getJsxAttributeValue(icon.openingElement, "data-icon");
  const line = getLineNumber(file, icon.openingElement);

  if (!expectedPosition) {
    return advisory(
      `${icon.tagName} appears between dynamic or multiple Button content nodes, so its inline position cannot be verified statically.`,
      'Set `data-icon="inline-start"` or `data-icon="inline-end"` to match the icon\'s rendered position.',
      file.filePath,
      line
    );
  }

  if (dataIcon.kind === "absent") {
    if (hasSpreadAttribute(icon.openingElement)) {
      return advisory(
        `${icon.tagName} may receive data-icon through spread props, which cannot be verified statically.`,
        `Ensure the spread always supplies data-icon="${expectedPosition}" for this Button icon.`,
        file.filePath,
        line
      );
    }

    return fail(
      `${icon.tagName} inside Button is missing data-icon="${expectedPosition}".`,
      `Add data-icon="${expectedPosition}" to the icon so the shadcn Button applies the correct inline spacing.`,
      {
        filePath: file.filePath,
        line,
        roast: "The icon arrived without its spacing instructions.",
      }
    );
  }

  if (dataIcon.kind === "dynamic") {
    return advisory(
      `${icon.tagName} uses a dynamic data-icon value that cannot be verified statically.`,
      `Ensure the value always resolves to "${expectedPosition}" in this Button position.`,
      file.filePath,
      line
    );
  }

  if (dataIcon.value !== expectedPosition) {
    const renderedValue =
      typeof dataIcon.value === "string"
        ? `"${dataIcon.value}"`
        : String(dataIcon.value);
    return fail(
      `${icon.tagName} inside Button uses data-icon=${renderedValue}; expected "${expectedPosition}".`,
      `Set data-icon="${expectedPosition}" so the shadcn Button applies spacing on the correct side.`,
      { filePath: file.filePath, line }
    );
  }

  return null;
};

const getContentPositions = (
  children: readonly JsxChild[],
  icons: readonly IconCandidate[]
): ContentPositions | null => {
  const iconIndexes = new Set(icons.map((icon) => icon.childIndex));
  const contentIndexes: number[] = [];
  let hasKnownContent = false;
  let hasUnknownContent = false;

  for (const [childIndex, child] of children.entries()) {
    if (iconIndexes.has(childIndex)) {
      continue;
    }

    const textState = getVisibleTextState([child]);
    if (textState === "valid") {
      contentIndexes.push(childIndex);
      hasKnownContent = true;
    } else if (textState === "unknown") {
      contentIndexes.push(childIndex);
      hasUnknownContent = true;
    }
  }

  if (!(hasKnownContent || hasUnknownContent)) {
    return null;
  }

  return { indexes: contentIndexes, isDynamic: hasUnknownContent };
};

const toAdvisoryResult = (
  result: AuditRuleResult,
  file: ParsedSourceFile,
  icon: IconCandidate
): AuditRuleResult =>
  result.status === "fail"
    ? advisory(
        result.evidence?.[0]?.message ??
          "A Button icon may be missing position-correct spacing metadata.",
        result.remediation ??
          "Verify the icon's data-icon value against its rendered position.",
        file.filePath,
        getLineNumber(file, icon.openingElement)
      )
    : result;

const evaluateButton = ({
  file,
  importedButtons,
  importedIcons,
  node,
}: {
  file: ParsedSourceFile;
  importedButtons: ImportedComponents;
  importedIcons: ImportedComponents;
  node: JsxElement;
}): ButtonEvaluation => {
  const buttonTagName = getJsxTagName(node.openingElement);
  if (!(buttonTagName && isImportedComponent(buttonTagName, importedButtons))) {
    return { inlineIconCount: 0, result: null };
  }

  const children = getButtonChildren(node);
  const icons = getIconCandidates(children, importedIcons);
  if (icons.length === 0) {
    return { inlineIconCount: 0, result: null };
  }

  const content = getContentPositions(children, icons);
  if (!content) {
    return { inlineIconCount: 0, result: null };
  }

  let uncertainResult: AuditRuleResult | null = null;

  for (const icon of icons) {
    const result = evaluateIcon({
      expectedPosition: getExpectedPosition(icon.childIndex, content.indexes),
      file,
      icon,
    });
    if (!result) {
      continue;
    }

    if (result.status === "fail" && !content.isDynamic) {
      return { inlineIconCount: icons.length, result };
    }

    uncertainResult ??= toAdvisoryResult(result, file, icon);
  }

  return { inlineIconCount: icons.length, result: uncertainResult };
};

const buttonIconsHaveDataIconRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "high",
  description:
    "Checks inline icons in shadcn Buttons for position-correct data-icon attributes.",
  id: "button-icons-have-data-icon",
  maxScore: 2,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    let inlineIconCount = 0;
    let uncertainResult: AuditRuleResult | null = null;
    let failure: AuditRuleResult | null = null;

    for (const file of files) {
      if (failure) {
        break;
      }

      const importedButtons = getImportedComponents(
        file.sourceFile,
        (moduleName) =>
          isShadcnButtonModule(moduleName, project.shadcn.aliases.ui),
        "Button"
      );
      if (
        importedButtons.names.size === 0 &&
        importedButtons.namespaces.size === 0
      ) {
        continue;
      }

      const importedIcons = getImportedComponents(
        file.sourceFile,
        isIconModule
      );

      visitJsxNodes([file], ({ node }) => {
        if (failure || !isJsxElement(node)) {
          return;
        }

        const evaluation = evaluateButton({
          file,
          importedButtons,
          importedIcons,
          node,
        });
        inlineIconCount += evaluation.inlineIconCount;

        if (evaluation.result?.status === "fail") {
          failure = evaluation.result;
        } else if (evaluation.result) {
          uncertainResult ??= evaluation.result;
        }
      });
    }

    if (failure) {
      return failure;
    }

    if (uncertainResult) {
      return uncertainResult;
    }

    if (inlineIconCount === 0) {
      return notApplicable("No shadcn Buttons with inline icons were found.");
    }

    return pass(
      `All ${inlineIconCount} inline shadcn Button icons declare position-correct data-icon attributes.`
    );
  },
  severity: "warning",
  title: "button icons declare inline spacing",
};

export { buttonIconsHaveDataIconRule };
