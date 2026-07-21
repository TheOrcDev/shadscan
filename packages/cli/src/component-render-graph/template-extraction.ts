import {
  type BinaryExpression,
  type ConditionalExpression,
  type Expression,
  isArrayLiteralExpression,
  isAsExpression,
  isAwaitExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isOmittedExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSatisfiesExpression,
  isSpreadElement,
  isStringLiteral,
  isTypeAssertionExpression,
  isVariableStatement,
  type JsxChild,
  type JsxOpeningLikeElement,
  type Node,
  NodeFlags,
  SyntaxKind,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  isFunctionOwner,
  walkNodes,
} from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import {
  getResponsiveVisibility,
  getResponsiveVisibilityFromClassNames,
} from "../rules/responsive-visibility";
import {
  bodyMayReferenceProp,
  declarationBindsComponentName,
  declarationBindsValueName,
  expressionProjectsChildren,
  getJsxClassNameForwarding,
} from "./component-properties";
import { isPotentialNavigationTag } from "./navigation-syntax";
import { collectRenderedReturnItems, getRenderGuard } from "./return-flow";
import { getEdgeId } from "./source-index";
import { resolveElementTarget } from "./symbol-resolution";
import type {
  ComponentGraphEdge,
  ComponentId,
  ComponentNodeRecord,
  GraphBuildState,
  ProjectionContent,
  RenderGuard,
  RenderOpaqueTemplate,
  RenderTemplateItem,
  TemplateContext,
} from "./types";

const createTemplateContext = (): TemplateContext => ({
  guards: [],
  multiplicity: "one",
  uncertaintyReasons: [],
});

const appendGuard = (
  context: TemplateContext,
  guard: RenderGuard
): TemplateContext => ({ ...context, guards: [...context.guards, guard] });

const getBinaryBranch = (
  node: BinaryExpression
): RenderGuard["branch"] | null => {
  if (node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
    return "truthy";
  }

  return node.operatorToken.kind === SyntaxKind.BarBarToken ? "falsy" : null;
};

const isMapCall = (node: Node): boolean =>
  isCallExpression(node) &&
  isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "map";

interface ExpressionResolutionState {
  aliasDeclarations: Set<number>;
  depth: number;
}

const MAX_RENDERED_ALIAS_HOPS = 16;
const MAX_NAVIGATION_RELEVANCE_HOPS = 32;
const NAVIGATION_MEMBER_NAME_PATTERN =
  /(?:Content|Indicator|Item|Link|List|Trigger|Viewport)$/;
const POTENTIAL_REACT_NODE_MEMBER_PATTERN =
  /^(?:children|component|content|element|fallback|footer|header|navigation|node|render.*|sidebar|slot|view)$/i;

const createExpressionResolutionState = (): ExpressionResolutionState => ({
  aliasDeclarations: new Set(),
  depth: 0,
});

const getLocalConstInitializer = (
  owner: ComponentNodeRecord,
  localName: string,
  before: number
): { declarationStart: number; expression: Expression } | null => {
  const body = owner.declaration.body;

  if (!(body && isBlock(body))) {
    return null;
  }

  let match: { declarationStart: number; expression: Expression } | null = null;

  for (const statement of body.statements) {
    if (statement.getStart(owner.file.sourceFile) >= before) {
      break;
    }

    if (
      !isVariableStatement(statement) ||
      statement.declarationList.flags !== NodeFlags.Const
    ) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.name.text === localName &&
        declaration.initializer
      ) {
        match = {
          declarationStart: declaration.getStart(owner.file.sourceFile),
          expression: declaration.initializer,
        };
      }
    }
  }

  return match;
};

const getRootIdentifier = (expression: Expression): string | null => {
  let current = expression;

  while (isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  return isIdentifier(current) ? current.text : null;
};

const boundValueMayRenderNavigation = (
  owner: ComponentNodeRecord,
  expression: Expression
): boolean => {
  const rootIdentifier = getRootIdentifier(expression);
  if (
    !(
      rootIdentifier &&
      declarationBindsValueName(owner.declaration, rootIdentifier)
    )
  ) {
    return false;
  }

  if (isIdentifier(expression)) {
    return POTENTIAL_REACT_NODE_MEMBER_PATTERN.test(expression.text);
  }

  return (
    isPropertyAccessExpression(expression) &&
    POTENTIAL_REACT_NODE_MEMBER_PATTERN.test(expression.name.text)
  );
};

const isDefinitelyNonNavigationExpression = (expression: Expression): boolean =>
  isStringLiteral(expression) ||
  isNoSubstitutionTemplateLiteral(expression) ||
  isNumericLiteral(expression) ||
  [
    SyntaxKind.FalseKeyword,
    SyntaxKind.NullKeyword,
    SyntaxKind.TrueKeyword,
    SyntaxKind.UndefinedKeyword,
  ].includes(expression.kind);

const isNavigationNameFallback = (tagName: string): boolean => {
  const segments = tagName.split(".");
  const leafName = segments.at(-1) ?? tagName;

  if (NAVIGATION_MEMBER_NAME_PATTERN.test(leafName)) {
    return false;
  }

  return isPotentialNavigationTag(tagName);
};

const unsupportedExpressionMayRenderNavigation = (
  owner: ComponentNodeRecord,
  expression: Expression,
  state: GraphBuildState
): boolean => {
  if (subtreeMayRenderNavigation(owner, expression, state)) {
    return true;
  }

  if (boundValueMayRenderNavigation(owner, expression)) {
    return true;
  }

  if (!isCallExpression(expression)) {
    return false;
  }

  if (boundValueMayRenderNavigation(owner, expression.expression)) {
    return true;
  }

  return expression.arguments.some(
    (argument) =>
      subtreeMayRenderNavigation(owner, argument, state) ||
      boundValueMayRenderNavigation(owner, argument)
  );
};

const getLiteralControlPropNames = (node: JsxOpeningLikeElement): string[] => {
  const names = new Set<string>();

  for (const property of node.attributes.properties) {
    if (
      !isJsxAttribute(property) ||
      ["aria-label", "aria-labelledby", "class", "className", "key"].includes(
        property.name.getText()
      )
    ) {
      continue;
    }

    if (!property.initializer || isStringLiteral(property.initializer)) {
      names.add(property.name.getText());
      continue;
    }

    const isLiteral = Boolean(
      isJsxExpression(property.initializer) &&
        property.initializer.expression &&
        (isStringLiteral(property.initializer.expression) ||
          isNumericLiteral(property.initializer.expression) ||
          [SyntaxKind.FalseKeyword, SyntaxKind.TrueKeyword].includes(
            property.initializer.expression.kind
          ))
    );
    if (isLiteral) {
      names.add(property.name.getText());
    }
  }

  return [...names].sort(compareCodeUnits);
};

const getOwnerFileRecord = (
  owner: ComponentNodeRecord,
  state: GraphBuildState
) =>
  state.fileRecords.get(owner.filePath) ?? {
    exportReferences: new Map(),
    hasExportStar: false,
    imports: new Map(),
    localComponents: new Map(),
    parsed: owner.file,
    potentialNavigation: false,
  };

const isKnownRadixNavigationMenuRoot = (
  owner: ComponentNodeRecord,
  tagName: string,
  state: GraphBuildState
): boolean => {
  const [rootName, ...memberNames] = tagName.split(".");
  const binding = rootName
    ? getOwnerFileRecord(owner, state).imports.get(rootName)
    : undefined;

  if (!binding) {
    return false;
  }

  if (binding.moduleName === "@radix-ui/react-navigation-menu") {
    return binding.kind === "namespace"
      ? memberNames.length === 1 && memberNames[0] === "Root"
      : binding.importedName === "Root" && memberNames.length === 0;
  }

  return (
    binding.moduleName === "radix-ui" &&
    binding.kind === "binding" &&
    binding.importedName === "NavigationMenu" &&
    memberNames.length === 1 &&
    memberNames[0] === "Root"
  );
};

interface NavigationRelevanceState {
  depth: number;
  visitedComponents: Set<ComponentId>;
}

const componentDeclarationMayRenderNavigation = (
  component: ComponentNodeRecord,
  state: GraphBuildState,
  relevanceState: NavigationRelevanceState
): boolean => {
  if (relevanceState.visitedComponents.has(component.id)) {
    return false;
  }

  if (relevanceState.depth >= MAX_NAVIGATION_RELEVANCE_HOPS) {
    return true;
  }

  return nodeMayRenderNavigation(component, component.declaration, state, {
    depth: relevanceState.depth + 1,
    visitedComponents: new Set([
      ...relevanceState.visitedComponents,
      component.id,
    ]),
  });
};

const isNestedMapCallback = (
  functionOwner: Node,
  ancestors: Node[]
): boolean => {
  const ownerIndex = ancestors.lastIndexOf(functionOwner);
  const parent = ownerIndex > 0 ? ancestors[ownerIndex - 1] : undefined;
  return Boolean(parent && isMapCall(parent));
};

const nodeMayRenderNavigation = (
  owner: ComponentNodeRecord,
  node: Node,
  state: GraphBuildState,
  relevanceState: NavigationRelevanceState
): boolean => {
  let relevant = false;
  const skipsNestedFunctionBodies = node === owner.declaration;

  walkNodes(node, (candidate, ancestors) => {
    if (relevant) {
      return;
    }

    if (
      skipsNestedFunctionBodies &&
      ancestors.some((ancestor) => {
        if (ancestor === owner.declaration || !isFunctionOwner(ancestor)) {
          return false;
        }

        return !isNestedMapCallback(ancestor, ancestors);
      })
    ) {
      return;
    }

    let opening: JsxOpeningLikeElement | null = null;
    if (isJsxElement(candidate)) {
      opening = candidate.openingElement;
    } else if (isJsxSelfClosingElement(candidate)) {
      opening = candidate;
    }
    const tagName = opening ? getJsxTagName(opening) : null;

    if (!tagName) {
      return;
    }

    const result = resolveElementTarget(
      getOwnerFileRecord(owner, state),
      tagName,
      state,
      owner
    );
    if (result.target) {
      relevant = componentDeclarationMayRenderNavigation(
        result.target,
        state,
        relevanceState
      );
      return;
    }

    relevant = Boolean(
      result.potentialNavigation || isNavigationNameFallback(tagName)
    );
  });

  return relevant;
};

const subtreeMayRenderNavigation = (
  owner: ComponentNodeRecord,
  node: Node,
  state: GraphBuildState
): boolean =>
  nodeMayRenderNavigation(owner, node, state, {
    depth: 0,
    visitedComponents: new Set([owner.id]),
  });

const createOpaqueTemplate = (
  owner: ComponentNodeRecord,
  node: Node,
  context: TemplateContext,
  reason: string,
  relevant: boolean
): RenderOpaqueTemplate => ({
  guards: context.guards,
  id: JSON.stringify([
    owner.id,
    "opaque",
    node.getStart(owner.file.sourceFile),
  ]),
  kind: "opaque",
  reason,
  relevant,
});

const hasMeaningfulVisibility = (
  visibility: ReturnType<typeof getResponsiveVisibility>
): boolean => visibility.bands.some((band) => band !== "visible");

const createEdgeLimitMarker = (
  owner: ComponentNodeRecord,
  node: Node,
  context: TemplateContext,
  state: GraphBuildState
): RenderOpaqueTemplate => {
  const reason = `Component graph edge limit (${state.limits.maxEdges}) was reached.`;
  state.graphBoundaryReasons.add(reason);
  state.edgeTraversalHalted = true;
  state.metrics.edgeTruncationMarkers += 1;
  return createOpaqueTemplate(owner, node, context, reason, true);
};

const collectLocalAlias = (
  owner: ComponentNodeRecord,
  expression: Expression,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] | null => {
  if (!isIdentifier(expression)) {
    return null;
  }

  const localAlias = getLocalConstInitializer(
    owner,
    expression.text,
    expression.getStart(owner.file.sourceFile)
  );
  if (!localAlias) {
    return null;
  }

  const aliasLimitReached =
    resolutionState.depth >= MAX_RENDERED_ALIAS_HOPS ||
    resolutionState.aliasDeclarations.has(localAlias.declarationStart);

  if (aliasLimitReached) {
    return [
      createOpaqueTemplate(
        owner,
        expression,
        context,
        "A rendered local JSX alias exceeded the bounded resolution limit.",
        unsupportedExpressionMayRenderNavigation(
          owner,
          localAlias.expression,
          state
        )
      ),
    ];
  }

  return collectRenderedExpression(
    owner,
    localAlias.expression,
    context,
    state,
    {
      aliasDeclarations: new Set([
        ...resolutionState.aliasDeclarations,
        localAlias.declarationStart,
      ]),
      depth: resolutionState.depth + 1,
    }
  );
};

const collectArrayItems = (
  owner: ComponentNodeRecord,
  expression: Expression,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] | null => {
  if (!isArrayLiteralExpression(expression)) {
    return null;
  }

  const items: RenderTemplateItem[] = [];

  for (const element of expression.elements) {
    if (state.edgeTraversalHalted) {
      break;
    }

    if (isOmittedExpression(element)) {
      continue;
    }

    if (isSpreadElement(element)) {
      const spreadItems = collectRenderedExpression(
        owner,
        element.expression,
        context,
        state,
        resolutionState
      );
      items.push(
        ...(spreadItems.length > 0
          ? spreadItems
          : [
              createOpaqueTemplate(
                owner,
                element,
                context,
                "A spread ReactNode array could not be statically expanded.",
                unsupportedExpressionMayRenderNavigation(
                  owner,
                  element.expression,
                  state
                )
              ),
            ])
      );
      continue;
    }

    items.push(
      ...collectRenderedExpression(
        owner,
        element,
        context,
        state,
        resolutionState
      )
    );
  }

  return items;
};

function collectRenderedExpression(
  owner: ComponentNodeRecord,
  expression: Expression,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState = createExpressionResolutionState()
): RenderTemplateItem[] {
  if (state.edgeTraversalHalted) {
    return [];
  }

  state.metrics.templateNodesVisited += 1;

  if (isParenthesizedExpression(expression)) {
    return collectRenderedExpression(
      owner,
      expression.expression,
      context,
      state,
      resolutionState
    );
  }

  if (
    isAsExpression(expression) ||
    isAwaitExpression(expression) ||
    isNonNullExpression(expression) ||
    isSatisfiesExpression(expression) ||
    isTypeAssertionExpression(expression)
  ) {
    return collectRenderedExpression(
      owner,
      expression.expression,
      context,
      state,
      resolutionState
    );
  }

  if (expressionProjectsChildren(expression, owner.childrenBindings)) {
    return [
      {
        guards: context.guards,
        id: JSON.stringify([
          owner.id,
          "children",
          expression.getStart(owner.file.sourceFile),
        ]),
        kind: "children-projection",
        uncertaintyReasons: context.uncertaintyReasons,
      },
    ];
  }

  const aliasItems = collectLocalAlias(
    owner,
    expression,
    context,
    state,
    resolutionState
  );
  if (aliasItems) {
    return aliasItems;
  }

  const arrayItems = collectArrayItems(
    owner,
    expression,
    context,
    state,
    resolutionState
  );
  if (arrayItems) {
    return arrayItems;
  }

  if (isJsxElement(expression)) {
    return [
      createElementTemplate(
        owner,
        expression.openingElement,
        expression.children,
        context,
        state,
        resolutionState
      ),
    ];
  }

  if (isJsxSelfClosingElement(expression)) {
    return [
      createElementTemplate(
        owner,
        expression,
        [],
        context,
        state,
        resolutionState
      ),
    ];
  }

  if (isJsxFragment(expression)) {
    return collectRenderedChildren(
      owner,
      expression.children,
      context,
      state,
      resolutionState
    );
  }

  if (isConditionalExpression(expression)) {
    return collectConditionalItems(
      owner,
      expression,
      context,
      state,
      resolutionState
    );
  }

  if (isBinaryExpression(expression)) {
    return collectBinaryItems(
      owner,
      expression,
      context,
      state,
      resolutionState
    );
  }

  if (isMapCall(expression)) {
    return [
      createOpaqueTemplate(
        owner,
        expression,
        context,
        "JSX rendered through map() has unknown multiplicity.",
        subtreeMayRenderNavigation(owner, expression, state)
      ),
    ];
  }

  if (
    !isDefinitelyNonNavigationExpression(expression) &&
    unsupportedExpressionMayRenderNavigation(owner, expression, state)
  ) {
    return [
      createOpaqueTemplate(
        owner,
        expression,
        context,
        "A returned ReactNode expression could not be statically expanded.",
        true
      ),
    ];
  }

  return [];
}

const collectRenderedChild = (
  owner: ComponentNodeRecord,
  child: JsxChild,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] => {
  if (isJsxExpression(child)) {
    return child.expression
      ? collectRenderedExpression(
          owner,
          child.expression,
          context,
          state,
          resolutionState
        )
      : [];
  }

  return isJsxElement(child) || isJsxSelfClosingElement(child)
    ? collectRenderedExpression(owner, child, context, state, resolutionState)
    : [];
};

const collectRenderedChildren = (
  owner: ComponentNodeRecord,
  children: readonly JsxChild[],
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] => {
  const items: RenderTemplateItem[] = [];

  for (const child of children) {
    if (state.edgeTraversalHalted) {
      break;
    }
    items.push(
      ...collectRenderedChild(owner, child, context, state, resolutionState)
    );
  }

  return items;
};

const createElementTemplate = (
  owner: ComponentNodeRecord,
  node: JsxOpeningLikeElement,
  children: readonly JsxChild[],
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem => {
  if (state.edges.length >= state.limits.maxEdges) {
    return createEdgeLimitMarker(owner, node, context, state);
  }

  const tagName = getJsxTagName(node) ?? node.tagName.getText();
  const targetResult = resolveElementTarget(
    getOwnerFileRecord(owner, state),
    tagName,
    state,
    owner
  );
  const callsiteStart = node.getStart(owner.file.sourceFile);
  const edge: ComponentGraphEdge = {
    callsiteStart,
    filePath: owner.filePath,
    from: owner.id,
    id: getEdgeId(owner.id, callsiteStart),
    line: getLineNumber(owner.file, node),
    multiplicity: context.multiplicity,
    resolution: targetResult.resolution,
    tagName,
    target: targetResult.target?.id ?? null,
  };
  state.edges.push(edge);

  const childItems = collectRenderedChildren(
    owner,
    children,
    context,
    state,
    resolutionState
  );
  const hasNavigationRelevantProp = node.attributes.properties.some(
    (property) => subtreeMayRenderNavigation(owner, property, state)
  );
  const targetMayRenderNavigation = targetResult.target
    ? componentDeclarationMayRenderNavigation(targetResult.target, state, {
        depth: 0,
        visitedComponents: new Set([owner.id]),
      })
    : targetResult.potentialNavigation;
  let relevantBoundaryReason = hasNavigationRelevantProp
    ? "Navigation JSX supplied through a component prop was not statically expanded."
    : null;

  if (
    !relevantBoundaryReason &&
    targetResult.boundaryReason &&
    !isKnownRadixNavigationMenuRoot(owner, tagName, state) &&
    ((!targetResult.target && isNavigationNameFallback(tagName)) ||
      declarationBindsComponentName(owner.declaration, tagName) ||
      targetMayRenderNavigation ||
      childItems.some(templateMayRenderNavigation))
  ) {
    relevantBoundaryReason = targetResult.boundaryReason;
  }

  const classNameForwarding = getJsxClassNameForwarding(
    node,
    owner.classNameBindings
  );
  const rawVisibility = classNameForwarding.forwards
    ? getResponsiveVisibilityFromClassNames(
        classNameForwarding.staticClassNames
      )
    : getResponsiveVisibility(node);

  return {
    children: childItems,
    edge,
    file: owner.file,
    guards: context.guards,
    hasMeaningfulCallsiteVisibility: hasMeaningfulVisibility(rawVisibility),
    kind: "element",
    literalControlPropNames: getLiteralControlPropNames(node),
    localVisibility: rawVisibility,
    node,
    relevantBoundaryReason,
    uncertaintyReasons: context.uncertaintyReasons,
    usesForwardedClassName: classNameForwarding.forwards,
  };
};

const collectConditionalItems = (
  owner: ComponentNodeRecord,
  node: ConditionalExpression,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] => [
  ...collectRenderedExpression(
    owner,
    node.whenTrue,
    appendGuard(context, getRenderGuard(owner, node.condition, "truthy")),
    state,
    resolutionState
  ),
  ...collectRenderedExpression(
    owner,
    node.whenFalse,
    appendGuard(context, getRenderGuard(owner, node.condition, "falsy")),
    state,
    resolutionState
  ),
];

const collectBinaryItems = (
  owner: ComponentNodeRecord,
  node: BinaryExpression,
  context: TemplateContext,
  state: GraphBuildState,
  resolutionState: ExpressionResolutionState
): RenderTemplateItem[] => {
  if (node.operatorToken.kind === SyntaxKind.CommaToken) {
    return collectRenderedExpression(
      owner,
      node.right,
      context,
      state,
      resolutionState
    );
  }

  const branch = getBinaryBranch(node);

  if (branch === "truthy") {
    return collectRenderedExpression(
      owner,
      node.right,
      appendGuard(context, getRenderGuard(owner, node.left, branch)),
      state,
      resolutionState
    );
  }

  if (
    branch === "falsy" ||
    node.operatorToken.kind === SyntaxKind.QuestionQuestionToken
  ) {
    const leftBranch = "truthy";
    const rightBranch = "falsy";

    return [
      ...collectRenderedExpression(
        owner,
        node.left,
        appendGuard(context, getRenderGuard(owner, node.left, leftBranch)),
        state,
        resolutionState
      ),
      ...collectRenderedExpression(
        owner,
        node.right,
        appendGuard(context, getRenderGuard(owner, node.left, rightBranch)),
        state,
        resolutionState
      ),
    ];
  }

  return [
    createOpaqueTemplate(
      owner,
      node,
      context,
      "A returned binary ReactNode expression could not be statically expanded.",
      subtreeMayRenderNavigation(owner, node, state)
    ),
  ];
};

const templateMayRenderNavigation = (item: RenderTemplateItem): boolean => {
  if (item.kind === "opaque") {
    return item.relevant;
  }

  if (item.kind === "children-projection") {
    return false;
  }

  return (
    (!item.edge.target && isNavigationNameFallback(item.edge.tagName)) ||
    Boolean(item.relevantBoundaryReason) ||
    item.children.some(templateMayRenderNavigation)
  );
};

const componentMayRenderNavigation = (
  componentId: ComponentId,
  state: GraphBuildState
): boolean => {
  initializeNavigationReachability(state);
  return state.navigationReachability.get(componentId) === "yes";
};

const collectTemplateTargets = (
  items: RenderTemplateItem[],
  targets: Set<ComponentId>
): void => {
  for (const item of items) {
    if (item.kind !== "element") {
      continue;
    }

    if (item.edge.target) {
      targets.add(item.edge.target);
    }
    collectTemplateTargets(item.children, targets);
  }
};

const initializeNavigationReachability = (state: GraphBuildState): void => {
  if (state.navigationReachabilityInitialized) {
    return;
  }

  const reverseEdges = new Map<ComponentId, Set<ComponentId>>();
  const queue: ComponentId[] = [];

  for (const node of state.nodeRecords.values()) {
    state.metrics.navigationReachabilityEvaluations += 1;
    state.navigationReachability.set(node.id, "unknown");

    if (node.template.some(templateMayRenderNavigation)) {
      state.navigationReachability.set(node.id, "yes");
      queue.push(node.id);
    }

    const targets = new Set<ComponentId>();
    collectTemplateTargets(node.template, targets);
    for (const target of targets) {
      const owners = reverseEdges.get(target) ?? new Set<ComponentId>();
      owners.add(node.id);
      reverseEdges.set(target, owners);
    }
  }

  for (const target of queue) {
    for (const owner of reverseEdges.get(target) ?? []) {
      if (state.navigationReachability.get(owner) === "yes") {
        continue;
      }
      state.navigationReachability.set(owner, "yes");
      queue.push(owner);
    }
  }

  for (const node of state.nodeRecords.values()) {
    if (state.navigationReachability.get(node.id) === "unknown") {
      state.navigationReachability.set(node.id, "no");
    }
  }
  state.navigationReachabilityInitialized = true;
};

const templateContainsProjection = (item: RenderTemplateItem): boolean =>
  item.kind === "children-projection" ||
  (item.kind === "element" && item.children.some(templateContainsProjection));

const templateForwardsClassName = (item: RenderTemplateItem): boolean =>
  item.kind === "element" &&
  (item.usesForwardedClassName ||
    item.children.some(templateForwardsClassName));

const projectionContentMayRenderNavigation = (
  content: ProjectionContent,
  state: GraphBuildState
): boolean => {
  if (content.kind === "component") {
    return componentMayRenderNavigation(content.seed.componentId, state);
  }

  const itemMayRenderNavigation = (item: RenderTemplateItem): boolean =>
    templateMayRenderNavigation(item) ||
    (item.kind === "element" &&
      (Boolean(
        item.edge.target &&
          componentMayRenderNavigation(item.edge.target, state)
      ) ||
        item.children.some(itemMayRenderNavigation)));

  if (content.items.some(itemMayRenderNavigation)) {
    return true;
  }

  return Boolean(
    content.projectedChildren &&
      content.items.some(templateContainsProjection) &&
      projectionContentMayRenderNavigation(content.projectedChildren, state)
  );
};

const getChildrenProjection = (
  node: ComponentNodeRecord
): ComponentNodeRecord["childrenProjection"] => {
  if (node.template.some(templateContainsProjection)) {
    return "projected";
  }

  return bodyMayReferenceProp(
    node.declaration,
    node.childrenBindings,
    "children"
  )
    ? "unknown"
    : "ignored";
};

const getClassNameForwarding = (
  node: ComponentNodeRecord
): ComponentNodeRecord["classNameForwarding"] => {
  if (node.template.some(templateForwardsClassName)) {
    return "forwarded";
  }

  return bodyMayReferenceProp(
    node.declaration,
    node.classNameBindings,
    "className"
  )
    ? "unknown"
    : "ignored";
};

const buildTemplates = (state: GraphBuildState): void => {
  const nodes = [...state.nodeRecords.values()].sort((left, right) =>
    compareCodeUnits(left.id, right.id)
  );

  for (const node of nodes) {
    if (state.edgeTraversalHalted) {
      node.template = [];
      continue;
    }

    node.template = collectRenderedReturnItems(
      node,
      state,
      createTemplateContext(),
      collectRenderedExpression,
      subtreeMayRenderNavigation
    );
    node.childrenProjection = getChildrenProjection(node);
    node.projectsChildren = node.childrenProjection === "projected";
    node.classNameForwarding = getClassNameForwarding(node);
    node.exportNames.sort(compareCodeUnits);
  }
};

export {
  buildTemplates,
  componentMayRenderNavigation,
  projectionContentMayRenderNavigation,
  templateMayRenderNavigation,
};
