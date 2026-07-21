import {
  type BinaryExpression,
  type ConditionalExpression,
  type Expression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  type JsxChild,
  type JsxOpeningLikeElement,
  type Node,
  SyntaxKind,
} from "typescript";
import { getJsxTagName, getLineNumber, walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import {
  getResponsiveVisibility,
  getResponsiveVisibilityFromClassNames,
} from "../rules/responsive-visibility";
import {
  bodyMayReferenceProp,
  declarationBindsComponentName,
  expressionProjectsChildren,
  jsxNodeForwardsClassName,
} from "./component-properties";
import {
  isPotentialNavigationTag,
  subtreeHasPotentialNavigation,
} from "./navigation-syntax";
import { collectRenderedReturnItems } from "./return-flow";
import { getEdgeId, getGuard } from "./source-index";
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

const subtreeMayRenderNavigation = (
  owner: ComponentNodeRecord,
  node: Node,
  state: GraphBuildState
): boolean => {
  if (subtreeHasPotentialNavigation(node)) {
    return true;
  }

  let relevant = false;
  walkNodes(node, (candidate) => {
    if (relevant) {
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
      state
    );
    relevant = Boolean(
      isPotentialNavigationTag(tagName) ||
        result.potentialNavigation ||
        (result.target &&
          state.fileRecords.get(result.target.filePath)?.potentialNavigation)
    );
  });

  return relevant;
};

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

const collectRenderedExpression = (
  owner: ComponentNodeRecord,
  expression: Expression,
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem[] => {
  if (state.edgeTraversalHalted) {
    return [];
  }

  state.metrics.templateNodesVisited += 1;

  if (isParenthesizedExpression(expression)) {
    return collectRenderedExpression(
      owner,
      expression.expression,
      context,
      state
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

  if (isJsxElement(expression)) {
    return [
      createElementTemplate(
        owner,
        expression.openingElement,
        expression.children,
        context,
        state
      ),
    ];
  }

  if (isJsxSelfClosingElement(expression)) {
    return [createElementTemplate(owner, expression, [], context, state)];
  }

  if (isJsxFragment(expression)) {
    return collectRenderedChildren(owner, expression.children, context, state);
  }

  if (isConditionalExpression(expression)) {
    return collectConditionalItems(owner, expression, context, state);
  }

  if (isBinaryExpression(expression)) {
    return collectBinaryItems(owner, expression, context, state);
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
    isCallExpression(expression) &&
    subtreeMayRenderNavigation(owner, expression, state)
  ) {
    return [
      createOpaqueTemplate(
        owner,
        expression,
        context,
        "Dynamic component composition could not be statically expanded.",
        true
      ),
    ];
  }

  return [];
};

const collectRenderedChild = (
  owner: ComponentNodeRecord,
  child: JsxChild,
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem[] => {
  if (isJsxExpression(child)) {
    return child.expression
      ? collectRenderedExpression(owner, child.expression, context, state)
      : [];
  }

  return isJsxElement(child) || isJsxSelfClosingElement(child)
    ? collectRenderedExpression(owner, child, context, state)
    : [];
};

const collectRenderedChildren = (
  owner: ComponentNodeRecord,
  children: readonly JsxChild[],
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem[] => {
  const items: RenderTemplateItem[] = [];

  for (const child of children) {
    if (state.edgeTraversalHalted) {
      break;
    }
    items.push(...collectRenderedChild(owner, child, context, state));
  }

  return items;
};

const createElementTemplate = (
  owner: ComponentNodeRecord,
  node: JsxOpeningLikeElement,
  children: readonly JsxChild[],
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem => {
  if (state.edges.length >= state.limits.maxEdges) {
    return createEdgeLimitMarker(owner, node, context, state);
  }

  const tagName = getJsxTagName(node) ?? node.tagName.getText();
  const targetResult = resolveElementTarget(
    getOwnerFileRecord(owner, state),
    tagName,
    state
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

  const childItems = collectRenderedChildren(owner, children, context, state);
  const hasNavigationRelevantProp = node.attributes.properties.some(
    (property) => subtreeMayRenderNavigation(owner, property, state)
  );
  const targetFileHasNavigation = targetResult.target
    ? state.fileRecords.get(targetResult.target.filePath)?.potentialNavigation
    : targetResult.potentialNavigation;
  let relevantBoundaryReason = hasNavigationRelevantProp
    ? "Navigation JSX supplied through a component prop was not statically expanded."
    : null;

  if (
    !relevantBoundaryReason &&
    targetResult.boundaryReason &&
    (isPotentialNavigationTag(tagName) ||
      declarationBindsComponentName(owner.declaration, tagName) ||
      targetFileHasNavigation ||
      childItems.some(templateMayRenderNavigation))
  ) {
    relevantBoundaryReason = targetResult.boundaryReason;
  }

  const rawVisibility = getResponsiveVisibility(node);
  const usesForwardedClassName =
    targetResult.resolution === "intrinsic" &&
    jsxNodeForwardsClassName(node, owner.classNameBindings);

  return {
    children: childItems,
    edge,
    file: owner.file,
    guards: context.guards,
    hasMeaningfulCallsiteVisibility: hasMeaningfulVisibility(rawVisibility),
    kind: "element",
    localVisibility: usesForwardedClassName
      ? getResponsiveVisibilityFromClassNames([])
      : rawVisibility,
    node,
    relevantBoundaryReason,
    uncertaintyReasons: context.uncertaintyReasons,
    usesForwardedClassName,
  };
};

const collectConditionalItems = (
  owner: ComponentNodeRecord,
  node: ConditionalExpression,
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem[] => [
  ...collectRenderedExpression(
    owner,
    node.whenTrue,
    appendGuard(context, getGuard(owner.file, node.condition, "truthy")),
    state
  ),
  ...collectRenderedExpression(
    owner,
    node.whenFalse,
    appendGuard(context, getGuard(owner.file, node.condition, "falsy")),
    state
  ),
];

const collectBinaryItems = (
  owner: ComponentNodeRecord,
  node: BinaryExpression,
  context: TemplateContext,
  state: GraphBuildState
): RenderTemplateItem[] => {
  const branch = getBinaryBranch(node);

  if (!branch) {
    return [];
  }

  return collectRenderedExpression(
    owner,
    node.right,
    appendGuard(context, getGuard(owner.file, node.left, branch)),
    state
  );
};

const templateMayRenderNavigation = (item: RenderTemplateItem): boolean => {
  if (item.kind === "opaque") {
    return item.relevant;
  }

  if (item.kind === "children-projection") {
    return false;
  }

  return (
    isPotentialNavigationTag(item.edge.tagName) ||
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

  if (
    content.items.some(
      (item) =>
        templateMayRenderNavigation(item) ||
        (item.kind === "element" &&
          Boolean(
            item.edge.target &&
              componentMayRenderNavigation(item.edge.target, state)
          ))
    )
  ) {
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
