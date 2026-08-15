import { compareCodeUnits } from "../deterministic-order";
import {
  getResponsiveVisibilityFromClassNames,
  type ResponsiveVisibility,
} from "../rules/responsive-visibility";
import { getPropBindings } from "./component-properties";
import { isPotentialNavigationTag } from "./navigation-syntax";
import {
  componentMayRenderNavigation,
  projectionContentMayRenderNavigation,
  templateMayRenderNavigation,
} from "./template-extraction";
import type {
  ComponentNodeRecord,
  ComponentRenderGraphLimits,
  ComponentRenderSurface,
  ComponentSeed,
  ExpansionState,
  GraphBuildState,
  GuardAppendResult,
  ImportBinding,
  ProjectionContent,
  RenderElementTemplate,
  RenderedJsxInstance,
  RenderGuard,
  RenderProjectionTemplate,
  RenderTemplateItem,
  SurfacePlan,
} from "./types";

const intersectVisibilities = (
  left: ResponsiveVisibility,
  right: ResponsiveVisibility
): ResponsiveVisibility => ({
  bands: left.bands.map((leftState, index) => {
    const rightState = right.bands[index] ?? "unknown";

    if (leftState === "hidden" || rightState === "hidden") {
      return "hidden";
    }

    return leftState === "visible" && rightState === "visible"
      ? "visible"
      : "unknown";
  }),
});

const guardsCanCoexist = (
  left: readonly RenderGuard[],
  right: readonly RenderGuard[]
): boolean => {
  const leftBranches = new Map(left.map((guard) => [guard.id, guard.branch]));

  return !right.some(
    (guard) =>
      leftBranches.has(guard.id) && leftBranches.get(guard.id) !== guard.branch
  );
};

const appendExpansionGuards = (
  state: ExpansionState,
  guards: RenderGuard[],
  limits: ComponentRenderGraphLimits
): GuardAppendResult => {
  const combined = [...state.guards];

  for (const guard of guards) {
    if (
      !combined.some(
        (candidate) =>
          candidate.id === guard.id && candidate.branch === guard.branch
      )
    ) {
      combined.push(guard);
    }
  }
  if (combined.length <= limits.maxGuardAtomsPerPath) {
    return { guards: combined, truncated: false };
  }

  return {
    guards: combined.slice(0, limits.maxGuardAtomsPerPath),
    truncated: true,
  };
};

const appendUniqueReasons = (left: string[], right: string[]): string[] => [
  ...left,
  ...right.filter((reason) => !left.includes(reason)),
];

const markSurfaceBoundary = (
  surface: ComponentRenderSurface,
  reason: string
): void => {
  if (!surface.boundaryReasons.includes(reason)) {
    surface.boundaryReasons.push(reason);
  }
  surface.completeness = "partial";
};

const getCallsiteVisibility = (
  item: RenderElementTemplate,
  state: ExpansionState,
  buildState: GraphBuildState
): { reason: string | null; visibility: ResponsiveVisibility } => {
  if (item.edge.resolution === "intrinsic") {
    const localVisibility = intersectVisibilities(
      state.visibility,
      item.localVisibility
    );

    return {
      reason: null,
      visibility:
        item.usesForwardedClassName && state.forwardedClassNameVisibility
          ? intersectVisibilities(
              localVisibility,
              state.forwardedClassNameVisibility
            )
          : localVisibility,
    };
  }

  if (!item.hasMeaningfulCallsiteVisibility) {
    return { reason: null, visibility: state.visibility };
  }

  const target = item.edge.target
    ? buildState.nodeRecords.get(item.edge.target)
    : null;

  if (target?.classNameForwarding === "forwarded") {
    return {
      reason: null,
      visibility: intersectVisibilities(state.visibility, item.localVisibility),
    };
  }

  if (target?.classNameForwarding === "ignored") {
    return { reason: null, visibility: state.visibility };
  }

  const navigationRelevant =
    isPotentialNavigationTag(item.edge.tagName) ||
    Boolean(
      item.edge.target &&
        componentMayRenderNavigation(item.edge.target, buildState)
    ) ||
    item.children.some(templateMayRenderNavigation);

  return {
    reason: navigationRelevant
      ? `Component ${item.edge.tagName} has responsive classes but className forwarding could not be proven.`
      : null,
    visibility: state.visibility,
  };
};

const getForwardedClassNameVisibility = (
  item: RenderElementTemplate,
  state: ExpansionState
): ResponsiveVisibility | null => {
  if (item.edge.resolution === "intrinsic") {
    return null;
  }

  let visibility = item.hasMeaningfulCallsiteVisibility
    ? item.localVisibility
    : null;

  if (item.usesForwardedClassName && state.forwardedClassNameVisibility) {
    visibility = visibility
      ? intersectVisibilities(visibility, state.forwardedClassNameVisibility)
      : state.forwardedClassNameVisibility;
  }

  return visibility;
};

const guardReferencesProp = (
  guard: RenderGuard,
  target: ComponentNodeRecord,
  propName: string
): boolean => {
  const referencedNames = guard.referencedNames ?? [];
  const bindings = getPropBindings(target.declaration, propName);

  if ([...bindings.valueNames].some((name) => referencedNames.includes(name))) {
    return true;
  }

  return Boolean(
    bindings.objectName &&
      referencedNames.includes(bindings.objectName) &&
      referencedNames.includes(propName)
  );
};

const templateHasLiteralPropGuard = (
  items: RenderTemplateItem[],
  target: ComponentNodeRecord,
  propNames: string[],
  buildState: GraphBuildState
): boolean =>
  items.some((templateItem) => {
    const itemMayRenderNavigation =
      templateMayRenderNavigation(templateItem) ||
      Boolean(
        templateItem.kind === "element" &&
          templateItem.edge.target &&
          componentMayRenderNavigation(templateItem.edge.target, buildState)
      );
    const guardMatches = templateItem.guards.some((guard) =>
      propNames.some((propName) => guardReferencesProp(guard, target, propName))
    );

    return (
      (itemMayRenderNavigation && guardMatches) ||
      (templateItem.kind === "element" &&
        templateHasLiteralPropGuard(
          templateItem.children,
          target,
          propNames,
          buildState
        ))
    );
  });

const getLiteralPropUncertainty = (
  item: RenderElementTemplate,
  buildState: GraphBuildState
): string | null => {
  if (!(item.literalControlPropNames.length > 0 && item.edge.target)) {
    return null;
  }

  const target = buildState.nodeRecords.get(item.edge.target);
  if (
    !(
      target &&
      templateHasLiteralPropGuard(
        target.template,
        target,
        item.literalControlPropNames,
        buildState
      )
    )
  ) {
    return null;
  }

  return componentMayRenderNavigation(target.id, buildState)
    ? `Literal props select conditional branches in ${item.edge.tagName}, but prop values were not propagated.`
    : null;
};

const emitInstance = (
  item: RenderElementTemplate,
  state: ExpansionState,
  buildState: GraphBuildState
): RenderedJsxInstance | null => {
  const { limits } = buildState;
  if (state.surface.instances.length >= limits.maxInstancesPerSurface) {
    markSurfaceBoundary(
      state.surface,
      `Rendered instance limit (${limits.maxInstancesPerSurface}) was reached for this surface.`
    );
    state.halted = true;
    return null;
  }

  if (state.totalInstances.value >= limits.maxTotalInstances) {
    state.graphBoundaryReasons.add(
      `Total rendered instance limit (${limits.maxTotalInstances}) was reached.`
    );
    state.halted = true;
    return null;
  }

  const guardResult = appendExpansionGuards(state, item.guards, limits);
  const guardLimitReason = `Render guard limit (${limits.maxGuardAtomsPerPath}) was reached.`;
  const callsiteVisibility = getCallsiteVisibility(item, state, buildState);
  const literalPropUncertainty = getLiteralPropUncertainty(item, buildState);
  const itemReasons = [
    ...item.uncertaintyReasons,
    ...(callsiteVisibility.reason ? [callsiteVisibility.reason] : []),
    ...(literalPropUncertainty ? [literalPropUncertainty] : []),
  ];
  const instance: RenderedJsxInstance = {
    componentId: item.edge.from,
    edgeId: item.edge.id,
    file: item.file,
    guards: guardResult.guards,
    id: JSON.stringify([state.surface.id, ...state.path, item.edge.id]),
    line: item.edge.line,
    multiplicity: item.edge.multiplicity === "unknown" ? "unknown" : "one",
    node: item.node,
    resolution: item.edge.resolution,
    resolvedTargetFilePath: item.edge.target
      ? (buildState.nodeRecords.get(item.edge.target)?.filePath ?? null)
      : null,
    surfaceId: state.surface.id,
    tagName: item.edge.tagName,
    uncertaintyReasons: appendUniqueReasons(
      state.uncertaintyReasons,
      guardResult.truncated ? [...itemReasons, guardLimitReason] : itemReasons
    ),
    visibility: callsiteVisibility.visibility,
  };
  state.surface.instances.push(instance);
  state.totalInstances.value += 1;
  return instance;
};

const expandProjectionContent = (
  content: ProjectionContent,
  state: ExpansionState,
  buildState: GraphBuildState
): void => {
  if (content.kind === "template") {
    expandTemplate(content.items, state, content.projectedChildren, buildState);
    return;
  }

  expandComponentSeed(content.seed, state, buildState);
};

const getExternalComponentBinding = (
  item: RenderElementTemplate,
  buildState: GraphBuildState
): {
  binding: ImportBinding;
  memberNames: string[];
} | null => {
  if (
    item.edge.resolution === "intrinsic" ||
    item.edge.resolution === "resolved"
  ) {
    return null;
  }

  const owner = buildState.nodeRecords.get(item.edge.from);
  const record = owner ? buildState.fileRecords.get(owner.filePath) : undefined;
  const [rootName, ...memberNames] = item.edge.tagName.split(".");
  const binding = rootName ? record?.imports.get(rootName) : undefined;

  return binding ? { binding, memberNames } : null;
};

/**
 * Providers from third-party packages that render nothing but their children.
 * Their own source is not in the project, so expansion cannot prove the
 * projection — but the composition below them is ours, and stopping here hides
 * every surface a route actually renders. Keyed by module so a same-named
 * export from elsewhere does not qualify.
 */
const CHILDREN_TRANSPARENT_PROVIDERS: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map([
  // React's own wrappers render their children verbatim. Suspense also takes a
  // `fallback`, but that is a prop rather than a child, so expanding children
  // describes the resolved render — which is the one every rule reasons about.
  ["react", new Set(["Fragment", "Profiler", "StrictMode", "Suspense"])],
  ["nuqs/adapters/next", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/next/app", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/next/pages", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/react", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/react-router", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/react-router/v6", new Set(["NuqsAdapter"])],
  ["nuqs/adapters/react-router/v7", new Set(["NuqsAdapter"])],
]);

const isChildrenTransparentProvider = (
  item: RenderElementTemplate,
  buildState: GraphBuildState
): boolean => {
  const componentBinding = getExternalComponentBinding(item, buildState);
  if (!componentBinding) {
    return false;
  }

  const { binding, memberNames } = componentBinding;
  const expected = CHILDREN_TRANSPARENT_PROVIDERS.get(binding.moduleName);
  if (!expected) {
    return false;
  }

  const [memberName] = memberNames;

  if (binding.kind === "namespace") {
    return (
      memberNames.length === 1 &&
      Boolean(memberName) &&
      expected.has(memberName as string)
    );
  }

  return (
    memberNames.length === 0 &&
    binding.importedName !== null &&
    expected.has(binding.importedName)
  );
};

const isNextThemesProvider = (
  item: RenderElementTemplate,
  buildState: GraphBuildState
): boolean => {
  const componentBinding = getExternalComponentBinding(item, buildState);
  if (!componentBinding) {
    return false;
  }

  const { binding, memberNames } = componentBinding;
  if (binding.moduleName !== "next-themes") {
    return false;
  }

  const [memberName] = memberNames;

  return binding.kind === "namespace"
    ? memberNames.length === 1 && memberName === "ThemeProvider"
    : binding.importedName === "ThemeProvider" && memberNames.length === 0;
};

const isRadixNavigationMenuRoot = (
  item: RenderElementTemplate,
  buildState: GraphBuildState
): boolean => {
  const componentBinding = getExternalComponentBinding(item, buildState);
  if (!componentBinding) {
    return false;
  }

  const { binding, memberNames } = componentBinding;

  if (binding.moduleName === "@radix-ui/react-navigation-menu") {
    return binding.kind === "namespace"
      ? memberNames.length === 1 && memberNames[0] === "Root"
      : binding.importedName === "Root" && memberNames.length === 0;
  }

  if (binding.moduleName !== "radix-ui") {
    return false;
  }

  return binding.kind === "namespace"
    ? memberNames.join(".") === "NavigationMenu.Root"
    : binding.importedName === "NavigationMenu" &&
        memberNames.length === 1 &&
        memberNames[0] === "Root";
};

const expandElementTarget = (
  item: RenderElementTemplate,
  instance: RenderedJsxInstance,
  state: ExpansionState,
  projectedChildren: ProjectionContent | null,
  buildState: GraphBuildState
): void => {
  const isIntrinsic = item.edge.resolution === "intrinsic";
  const childState: ExpansionState = {
    ...state,
    forwardedClassNameVisibility: isIntrinsic
      ? null
      : getForwardedClassNameVisibility(item, state),
    guards: instance.guards,
    path: [...state.path, item.edge.id],
    uncertaintyReasons: instance.uncertaintyReasons,
    visibility: isIntrinsic ? instance.visibility : state.visibility,
  };

  if (
    item.edge.tagName === "Component" &&
    state.dynamicComponent &&
    item.edge.resolution === "unresolved"
  ) {
    expandComponentSeed(state.dynamicComponent, childState, buildState);
    return;
  }

  if (item.relevantBoundaryReason) {
    markSurfaceBoundary(state.surface, item.relevantBoundaryReason);
  }

  if (item.edge.target) {
    const callerChildren =
      item.children.length > 0
        ? {
            items: item.children,
            kind: "template" as const,
            projectedChildren,
          }
        : null;
    expandComponentSeed(
      {
        componentId: item.edge.target,
        projectedChildren: callerChildren,
      },
      childState,
      buildState
    );
    return;
  }

  if (item.edge.resolution === "intrinsic") {
    expandTemplate(item.children, childState, projectedChildren, buildState);
    return;
  }

  if (
    isNextThemesProvider(item, buildState) ||
    isRadixNavigationMenuRoot(item, buildState) ||
    isChildrenTransparentProvider(item, buildState)
  ) {
    expandTemplate(
      item.children,
      { ...childState, forwardedClassNameVisibility: null },
      projectedChildren,
      buildState
    );
    return;
  }

  const callerChildren: ProjectionContent | null =
    item.children.length > 0
      ? {
          items: item.children,
          kind: "template",
          projectedChildren,
        }
      : null;
  if (
    callerChildren &&
    projectionContentMayRenderNavigation(callerChildren, buildState)
  ) {
    markSurfaceBoundary(
      state.surface,
      `Component ${item.edge.tagName} has navigation-relevant children but opaque children projection.`
    );
  }
};

const expandTemplate = (
  items: RenderTemplateItem[],
  state: ExpansionState,
  projectedChildren: ProjectionContent | null,
  buildState: GraphBuildState
): void => {
  for (const item of items) {
    if (state.halted) {
      return;
    }

    expandTemplateItem(item, state, projectedChildren, buildState);
  }
};

const expandProjectionTemplate = (
  item: RenderProjectionTemplate,
  state: ExpansionState,
  projectedChildren: ProjectionContent | null,
  buildState: GraphBuildState
): void => {
  if (!projectedChildren) {
    return;
  }

  const guardResult = appendExpansionGuards(
    state,
    item.guards,
    buildState.limits
  );
  const guardLimitReason = `Render guard limit (${buildState.limits.maxGuardAtomsPerPath}) was reached.`;
  const projectionState: ExpansionState = {
    ...state,
    forwardedClassNameVisibility: null,
    guards: guardResult.guards,
    path: [...state.path, item.id],
    uncertaintyReasons: appendUniqueReasons(
      state.uncertaintyReasons,
      guardResult.truncated
        ? [...item.uncertaintyReasons, guardLimitReason]
        : item.uncertaintyReasons
    ),
  };
  expandProjectionContent(projectedChildren, projectionState, buildState);
};

const markInstanceUncertainty = (
  item: RenderElementTemplate,
  instance: RenderedJsxInstance,
  surface: ComponentRenderSurface,
  buildState: GraphBuildState
): void => {
  const navigationRelevant =
    isPotentialNavigationTag(instance.tagName) ||
    item.children.some(templateMayRenderNavigation) ||
    Boolean(
      item.edge.target &&
        componentMayRenderNavigation(item.edge.target, buildState)
    );

  if (
    !navigationRelevant ||
    (instance.multiplicity !== "unknown" &&
      instance.uncertaintyReasons.length === 0)
  ) {
    return;
  }

  for (const reason of instance.uncertaintyReasons) {
    markSurfaceBoundary(surface, reason);
  }
};

const expandTemplateItem = (
  item: RenderTemplateItem,
  state: ExpansionState,
  projectedChildren: ProjectionContent | null,
  buildState: GraphBuildState
): void => {
  if (item.kind === "opaque") {
    if (item.relevant) {
      markSurfaceBoundary(state.surface, item.reason);
    }
    return;
  }

  if (item.kind === "children-projection") {
    expandProjectionTemplate(item, state, projectedChildren, buildState);
    return;
  }

  const instance = emitInstance(item, state, buildState);
  if (!instance) {
    return;
  }

  markInstanceUncertainty(item, instance, state.surface, buildState);
  expandElementTarget(item, instance, state, projectedChildren, buildState);
};

const expandComponentSeed = (
  seed: ComponentSeed,
  state: ExpansionState,
  buildState: GraphBuildState
): void => {
  if (state.halted) {
    return;
  }

  const node = buildState.nodeRecords.get(seed.componentId);
  if (!node) {
    markSurfaceBoundary(state.surface, "A render root component was omitted.");
    return;
  }

  if (state.activeComponents.includes(node.id)) {
    if (
      componentMayRenderNavigation(node.id, buildState) ||
      (seed.projectedChildren &&
        projectionContentMayRenderNavigation(
          seed.projectedChildren,
          buildState
        ))
    ) {
      markSurfaceBoundary(
        state.surface,
        `Component cycle stopped at ${node.localName ?? "anonymous component"}.`
      );
    }
    return;
  }

  if (state.activeComponents.length >= buildState.limits.maxDepth) {
    if (
      componentMayRenderNavigation(node.id, buildState) ||
      (seed.projectedChildren &&
        projectionContentMayRenderNavigation(
          seed.projectedChildren,
          buildState
        ))
    ) {
      markSurfaceBoundary(
        state.surface,
        `Component expansion depth limit (${buildState.limits.maxDepth}) was reached.`
      );
    }
    return;
  }

  let projectedChildren = seed.projectedChildren;

  if (projectedChildren && node.childrenProjection !== "projected") {
    if (
      node.childrenProjection === "unknown" &&
      projectionContentMayRenderNavigation(projectedChildren, buildState)
    ) {
      markSurfaceBoundary(
        state.surface,
        `Component ${node.localName ?? "anonymous component"} has navigation-relevant children but its children projection is unknown.`
      );
    }
    projectedChildren = null;
  }

  expandTemplate(
    node.template,
    {
      ...state,
      activeComponents: [...state.activeComponents, node.id],
      path: [...state.path, `component:${node.id}`],
    },
    projectedChildren,
    buildState
  );
};

const expandSurfacePlan = (
  plan: SurfacePlan,
  buildState: GraphBuildState,
  totalInstances: { value: number }
): ComponentRenderSurface => {
  const boundaryReasons = [...new Set(plan.boundaryReasons)].sort(
    compareCodeUnits
  );
  const surface: ComponentRenderSurface = {
    adapter: plan.adapter,
    boundaryReasons,
    completeness: boundaryReasons.length > 0 ? "partial" : "complete",
    id: plan.id,
    instances: [],
    routeKey: plan.routeKey,
  };

  if (plan.roots.length === 0) {
    markSurfaceBoundary(surface, "No recognizable render root was found.");
    return surface;
  }

  for (const [rootIndex, root] of plan.roots.entries()) {
    expandComponentSeed(
      root,
      {
        activeComponents: [],
        dynamicComponent: plan.dynamicComponent,
        forwardedClassNameVisibility: null,
        graphBoundaryReasons: buildState.graphBoundaryReasons,
        guards: [],
        halted: false,
        path: [`root:${rootIndex}`],
        surface,
        totalInstances,
        uncertaintyReasons: [],
        visibility: getResponsiveVisibilityFromClassNames([]),
      },
      buildState
    );
  }
  surface.boundaryReasons.sort(compareCodeUnits);
  return surface;
};

export { expandSurfacePlan, guardsCanCoexist };
