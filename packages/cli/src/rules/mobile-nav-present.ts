import {
  createSourceFile,
  type Expression,
  forEachChild,
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isAsExpression,
  isBindingElement,
  isCallExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isJsxText,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSatisfiesExpression,
  isSpreadElement,
  isStringLiteral,
  isVariableDeclaration,
  isVariableDeclarationList,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
  NodeFlags,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import {
  findOwnedSourceScopes,
  getJsxAttributeValue,
  getJsxTagName,
} from "../ast";
import type { AuditRule } from "../audit";
import {
  getResponsiveVisibility,
  isSmallScreenVisibility,
} from "./responsive-visibility";
import { fail, notApplicable, pass } from "./rule-result";
import {
  getProjectSourceFiles,
  getTextLineNumber,
  type SourceFile,
} from "./source-files";

interface StatePair {
  setterName: string;
  stateName: string;
}

interface TriggerCandidate {
  setters: Set<string>;
}

interface PanelCandidate {
  states: Set<string>;
}

const NAVIGATION_PATTERN = /<(?:nav|NavigationMenu|Sidebar)(?:\s|>)/;
const MOBILE_PANEL_PATTERN = /<(?:SheetContent|DrawerContent|Sidebar)(?:\s|>)/;
const MOBILE_TRIGGER_PATTERN =
  /<(?:SheetTrigger|DrawerTrigger|SidebarTrigger)(?:\s|>)|aria-label=["'][^"']*(?:menu|navigation)[^"']*["']|<(?:Menu|MenuIcon)(?:\s|>)/i;
const RESPONSIVE_PATTERN =
  /(?:sm:hidden|md:hidden|lg:hidden|useIsMobile|openMobile|data-mobile)/;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const MENU_NAME_PATTERN = /(?:menu|navigation)/i;
const INTERACTIVE_TRIGGER_PATTERN = /(?:Button|Trigger)$/;
const DIRECT_MOBILE_LAYOUT_PATTERN =
  /(?:^|\s)(?:grid-cols-[1-4]|flex-wrap|overflow-x-(?:auto|scroll))(?:\s|$)/;
const COMPACT_PRIMARY_MOBILE_LAYOUT_PATTERN =
  /(?:^|\s)(?:flex|inline-flex)(?:\s|$)/;
const PRIMARY_NAVIGATION_LABEL_PATTERN = /^(?:main|primary)$/i;
const MAX_COMPACT_PRIMARY_LINKS = 3;
const SHADCN_SIDEBAR_IMPORT_PATTERN =
  /from\s+["'][^"']*\/components\/ui\/sidebar["']/;
const SHADCN_SIDEBAR_RUNTIME_FILE_PATTERN =
  /[/\\]components[/\\]ui[/\\]sidebar\.[cm]?[jt]sx?$/;
const SHADCN_SIDEBAR_RUNTIME_PATTERN =
  /useIsMobile\s*\([\s\S]*?openMobile[\s\S]*?<Sheet\b[\s\S]*?<SheetContent\b/;
const SHADCN_SIDEBAR_COMPOSITION_PATTERN =
  /<SidebarProvider\b[\s\S]*?<Sidebar\b[\s\S]*?<(?:a|Link)\b/;
const SHADCN_SIDEBAR_TRIGGER_PATTERN = /<SidebarTrigger(?:\s|>)/;
const USE_SIDEBAR_PATTERN = /useSidebar\s*\(/;
const TOGGLE_SIDEBAR_PATTERN = /\btoggleSidebar\b/;
const SHADCN_SIDEBAR_HOOK_TRIGGER_PATTERN =
  /onClick\s*=\s*\{\s*toggleSidebar\s*\}/;
const NAVIGATION_TAGS = new Set(["NavigationMenu", "Sidebar", "nav"]);
const ACTIONABLE_LINK_TAGS = new Set(["Link", "NavigationMenuLink", "a"]);

const walkNodes = (
  node: Node,
  visitor: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[] = []
): void => {
  visitor(node, ancestors);
  forEachChild(node, (child) => {
    walkNodes(child, visitor, [...ancestors, node]);
  });
};

const isUseStateCall = (expression: Expression): boolean => {
  if (!isCallExpression(expression)) {
    return false;
  }

  if (isIdentifier(expression.expression)) {
    return expression.expression.text === "useState";
  }

  return (
    isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "useState"
  );
};

const getStatePairs = (
  sourceFile: import("typescript").SourceFile
): StatePair[] => {
  const pairs: StatePair[] = [];

  walkNodes(sourceFile, (node) => {
    if (
      !(
        isVariableDeclaration(node) &&
        isArrayBindingPattern(node.name) &&
        node.initializer &&
        isUseStateCall(node.initializer)
      )
    ) {
      return;
    }

    const stateElement = node.name.elements[0];
    const setterElement = node.name.elements[1];

    if (
      stateElement &&
      setterElement &&
      isBindingElement(stateElement) &&
      isBindingElement(setterElement) &&
      isIdentifier(stateElement.name) &&
      isIdentifier(setterElement.name)
    ) {
      pairs.push({
        setterName: setterElement.name.text,
        stateName: stateElement.name.text,
      });
    }
  });

  return pairs;
};

const getAttributeExpression = (
  node: JsxOpeningLikeElement,
  name: string
): Expression | null => {
  for (const property of node.attributes.properties) {
    if (!(isJsxAttribute(property) && property.name.getText() === name)) {
      continue;
    }

    const initializer = property.initializer;

    if (initializer && isJsxExpression(initializer) && initializer.expression) {
      return initializer.expression;
    }
  }

  return null;
};

const getCalledIdentifiers = (expression: Expression): Set<string> => {
  const identifiers = new Set<string>();

  walkNodes(expression, (node) => {
    if (isCallExpression(node) && isIdentifier(node.expression)) {
      identifiers.add(node.expression.text);
    }
  });

  return identifiers;
};

const getAccessibleText = (element: JsxElement): string => {
  const text: string[] = [];

  walkNodes(element, (node) => {
    if (isJsxText(node)) {
      text.push(node.text);
      return;
    }

    if (isStringLiteral(node) && isJsxExpression(node.parent)) {
      text.push(node.text);
    }
  });

  return text.join(" ").trim();
};

const hasAccessibleMenuName = (
  openingElement: JsxOpeningLikeElement,
  element: JsxElement | null
): boolean => {
  const label = getJsxAttributeValue(openingElement, "aria-label");

  if (
    label.kind === "static" &&
    typeof label.value === "string" &&
    MENU_NAME_PATTERN.test(label.value)
  ) {
    return true;
  }

  return Boolean(element && MENU_NAME_PATTERN.test(getAccessibleText(element)));
};

const isInteractiveTrigger = (node: JsxOpeningLikeElement): boolean => {
  const tagName = getJsxTagName(node);
  return Boolean(
    tagName &&
      (tagName === "button" || INTERACTIVE_TRIGGER_PATTERN.test(tagName))
  );
};

const getTriggerCandidate = (
  openingElement: JsxOpeningLikeElement,
  element: JsxElement | null,
  ancestors: Node[]
): TriggerCandidate | null => {
  const isAccessibleTrigger =
    isInteractiveTrigger(openingElement) &&
    hasAccessibleMenuName(openingElement, element);

  if (
    !(
      isAccessibleTrigger &&
      isSmallScreenVisibility(
        getResponsiveVisibility(openingElement, ancestors)
      )
    )
  ) {
    return null;
  }

  const onClick = getAttributeExpression(openingElement, "onClick");
  return onClick ? { setters: getCalledIdentifiers(onClick) } : null;
};

const getReferencedStateNames = (
  node: JsxOpeningLikeElement,
  statePairs: StatePair[]
): Set<string> => {
  const attributesText = node.attributes.getText();
  return new Set(
    statePairs
      .map((pair) => pair.stateName)
      .filter((stateName) =>
        new RegExp(`\\b${stateName}\\b`).test(attributesText)
      )
  );
};

const hasNavigationAndLink = (element: JsxElement): boolean => {
  let hasNavigation = false;
  let hasLink = false;

  walkNodes(element, (node) => {
    if (!(isJsxElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const openingElement = isJsxElement(node) ? node.openingElement : node;
    const tagName = getJsxTagName(openingElement);

    if (tagName && NAVIGATION_TAGS.has(tagName)) {
      hasNavigation = true;
    }

    if (tagName && ACTIONABLE_LINK_TAGS.has(tagName)) {
      hasLink = true;
    }
  });

  return hasNavigation && hasLink;
};

const getPanelCandidate = (
  element: JsxElement,
  ancestors: Node[],
  statePairs: StatePair[]
): PanelCandidate | null => {
  const openingElement = element.openingElement;
  const states = getReferencedStateNames(openingElement, statePairs);

  if (
    states.size === 0 ||
    !hasNavigationAndLink(element) ||
    !isSmallScreenVisibility(getResponsiveVisibility(openingElement, ancestors))
  ) {
    return null;
  }

  return { states };
};

const hasCustomMobileNavigation = (scopeContent: string): boolean => {
  const sourceFile = createSourceFile(
    "navigation-scope.tsx",
    scopeContent,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX
  );
  const statePairs = getStatePairs(sourceFile);

  if (statePairs.length === 0) {
    return false;
  }

  const triggers: TriggerCandidate[] = [];
  const panels: PanelCandidate[] = [];

  walkNodes(sourceFile, (node, ancestors) => {
    if (isJsxElement(node)) {
      const trigger = getTriggerCandidate(node.openingElement, node, ancestors);

      if (trigger) {
        triggers.push(trigger);
      }

      const panel = getPanelCandidate(node, ancestors, statePairs);

      if (panel) {
        panels.push(panel);
      }

      return;
    }

    if (isJsxSelfClosingElement(node)) {
      const trigger = getTriggerCandidate(node, null, ancestors);

      if (trigger) {
        triggers.push(trigger);
      }
    }
  });

  return statePairs.some((pair) =>
    triggers.some(
      (trigger) =>
        trigger.setters.has(pair.setterName) &&
        panels.some((panel) => panel.states.has(pair.stateName))
    )
  );
};

const hasPrimitiveMobileNavigation = (scopeContent: string): boolean =>
  MOBILE_PANEL_PATTERN.test(scopeContent) &&
  MOBILE_TRIGGER_PATTERN.test(scopeContent) &&
  RESPONSIVE_PATTERN.test(scopeContent);

const unwrapExpression = (expression: Expression): Expression => {
  let unwrappedExpression = expression;

  while (
    isAsExpression(unwrappedExpression) ||
    isParenthesizedExpression(unwrappedExpression) ||
    isSatisfiesExpression(unwrappedExpression)
  ) {
    unwrappedExpression = unwrappedExpression.expression;
  }

  return unwrappedExpression;
};

const getStaticArrayLengths = (
  fileContent: string
): ReadonlyMap<string, number | null> => {
  const sourceFile = createSourceFile(
    "navigation-file.tsx",
    fileContent,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX
  );
  const arrayLengths = new Map<string, number | null>();

  walkNodes(sourceFile, (node) => {
    if (!isVariableDeclaration(node)) {
      return;
    }

    if (!(isIdentifier(node.name) && node.initializer)) {
      return;
    }

    if (!isVariableDeclarationList(node.parent)) {
      return;
    }

    if (node.parent.flags !== NodeFlags.Const) {
      return;
    }

    const initializer = unwrapExpression(node.initializer);

    if (!isArrayLiteralExpression(initializer)) {
      return;
    }

    const declarationName = node.name.text;
    const staticLength = initializer.elements.some((element) =>
      isSpreadElement(element)
    )
      ? null
      : initializer.elements.length;

    if (arrayLengths.has(declarationName)) {
      arrayLengths.set(declarationName, null);
      return;
    }

    arrayLengths.set(declarationName, staticLength);
  });

  return arrayLengths;
};

const getMappedCollectionLength = (
  node: Node,
  staticArrayLengths: ReadonlyMap<string, number | null>
): number | null | undefined => {
  if (
    !(isCallExpression(node) && isPropertyAccessExpression(node.expression)) ||
    node.expression.name.text !== "map"
  ) {
    return;
  }

  const collection = unwrapExpression(node.expression.expression);

  if (isArrayLiteralExpression(collection)) {
    return collection.elements.some((element) => isSpreadElement(element))
      ? null
      : collection.elements.length;
  }

  if (isIdentifier(collection)) {
    return staticArrayLengths.get(collection.text) ?? null;
  }

  return null;
};

const getStaticLinkMultiplicity = (
  ancestors: Node[],
  staticArrayLengths: ReadonlyMap<string, number | null>
): number | null => {
  let multiplicity = 1;

  for (const ancestor of ancestors) {
    const collectionLength = getMappedCollectionLength(
      ancestor,
      staticArrayLengths
    );

    if (collectionLength === undefined) {
      continue;
    }

    if (collectionLength === null) {
      return null;
    }

    multiplicity *= collectionLength;
  }

  return multiplicity;
};

const getStaticRenderedLinkCount = (
  element: JsxElement,
  staticArrayLengths: ReadonlyMap<string, number | null>
): number | null => {
  let hasUnknownMultiplicity = false;
  let linkCount = 0;

  walkNodes(element, (node, ancestors) => {
    if (!(isJsxElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const openingElement = isJsxElement(node) ? node.openingElement : node;
    const tagName = getJsxTagName(openingElement);

    if (!(tagName && ACTIONABLE_LINK_TAGS.has(tagName))) {
      return;
    }

    const multiplicity = getStaticLinkMultiplicity(
      ancestors,
      staticArrayLengths
    );

    if (multiplicity === null) {
      hasUnknownMultiplicity = true;
      return;
    }

    linkCount += multiplicity;
  });

  return hasUnknownMultiplicity ? null : linkCount;
};

const hasDirectMobileNavigation = (
  scopeContent: string,
  fileContent: string
): boolean => {
  const sourceFile = createSourceFile(
    "navigation-scope.tsx",
    scopeContent,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX
  );
  const staticArrayLengths = getStaticArrayLengths(fileContent);
  let hasResponsiveNavigation = false;

  walkNodes(sourceFile, (node, ancestors) => {
    if (!(isJsxElement(node) && getJsxTagName(node.openingElement) === "nav")) {
      return;
    }

    const className = getJsxAttributeValue(node.openingElement, "className");
    const classValue =
      className.kind === "static" && typeof className.value === "string"
        ? className.value
        : null;
    const accessibleName = getJsxAttributeValue(
      node.openingElement,
      "aria-label"
    );
    const staticLinkCount = getStaticRenderedLinkCount(
      node,
      staticArrayLengths
    );
    const hasStaticallyBoundedCompactLinks =
      staticLinkCount !== null &&
      staticLinkCount > 0 &&
      staticLinkCount <= MAX_COMPACT_PRIMARY_LINKS;
    const hasNamedCompactPrimaryLayout =
      classValue !== null &&
      COMPACT_PRIMARY_MOBILE_LAYOUT_PATTERN.test(classValue) &&
      accessibleName.kind === "static" &&
      typeof accessibleName.value === "string" &&
      PRIMARY_NAVIGATION_LABEL_PATTERN.test(accessibleName.value.trim()) &&
      hasStaticallyBoundedCompactLinks;

    if (
      classValue &&
      (DIRECT_MOBILE_LAYOUT_PATTERN.test(classValue) ||
        hasNamedCompactPrimaryLayout) &&
      hasNavigationAndLink(node) &&
      getResponsiveVisibility(node.openingElement, ancestors).bands[0] ===
        "visible"
    ) {
      hasResponsiveNavigation = true;
    }
  });

  return hasResponsiveNavigation;
};

const findShadcnSidebarMobileNavigation = (
  files: SourceFile[]
): SourceFile | null => {
  const runtimeFile = files.find(
    (file) =>
      SHADCN_SIDEBAR_RUNTIME_FILE_PATTERN.test(file.path) &&
      SHADCN_SIDEBAR_RUNTIME_PATTERN.test(file.content)
  );

  if (!runtimeFile) {
    return null;
  }

  const compositionFile = files.find(
    (file) =>
      !GENERATED_UI_PATH_PATTERN.test(file.path) &&
      SHADCN_SIDEBAR_IMPORT_PATTERN.test(file.content) &&
      SHADCN_SIDEBAR_COMPOSITION_PATTERN.test(file.content)
  );
  const hasTrigger = files.some(
    (file) =>
      !GENERATED_UI_PATH_PATTERN.test(file.path) &&
      SHADCN_SIDEBAR_IMPORT_PATTERN.test(file.content) &&
      (SHADCN_SIDEBAR_TRIGGER_PATTERN.test(file.content) ||
        (USE_SIDEBAR_PATTERN.test(file.content) &&
          TOGGLE_SIDEBAR_PATTERN.test(file.content) &&
          SHADCN_SIDEBAR_HOOK_TRIGGER_PATTERN.test(file.content)))
  );

  return compositionFile && hasTrigger ? compositionFile : null;
};

const mobileNavPresentRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks apps with navigation for a responsive mobile trigger and panel.",
  id: "mobile-nav-present",
  maxScore: 3,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);
    const navigationScopes = (
      await findOwnedSourceScopes(project, NAVIGATION_PATTERN)
    ).filter((scope) => !GENERATED_UI_PATH_PATTERN.test(scope.file.filePath));

    if (navigationScopes.length === 0) {
      return notApplicable("No app-level navigation was found.");
    }

    for (const scope of navigationScopes) {
      if (
        hasPrimitiveMobileNavigation(scope.content) ||
        hasCustomMobileNavigation(scope.content)
      ) {
        return pass(
          "Responsive mobile navigation trigger and controlled panel found in one navigation surface.",
          scope.file.filePath,
          scope.line
        );
      }

      if (hasDirectMobileNavigation(scope.content, scope.file.content)) {
        return pass(
          "Always-visible navigation links use an explicit small-screen layout.",
          scope.file.filePath,
          scope.line
        );
      }
    }

    const sidebarNavigation = findShadcnSidebarMobileNavigation(sourceFiles);
    if (sidebarNavigation) {
      return pass(
        "Mounted shadcn Sidebar has a mobile Sheet runtime and an app-level trigger.",
        sidebarNavigation.path,
        getTextLineNumber(
          sidebarNavigation.content,
          SHADCN_SIDEBAR_COMPOSITION_PATTERN
        )
      );
    }

    const navigationScope = navigationScopes[0];
    return fail(
      "Navigation has no verifiable responsive mobile trigger and controlled panel.",
      "Add an accessible small-screen trigger connected to a responsive panel, or keep navigation links visible in an explicit small-screen layout.",
      {
        filePath: navigationScope?.file.filePath,
        line: navigationScope?.line,
        roast: "Desktop-only navigation in a phone-shaped world. Brave.",
      }
    );
  },
  severity: "warning",
  title: "mobile navigation is present",
};

export { mobileNavPresentRule };
