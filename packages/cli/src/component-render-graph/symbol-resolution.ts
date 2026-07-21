import path from "node:path";
import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  type Node,
  resolveModuleName,
} from "typescript";
import { compareCodeUnits } from "../deterministic-order";
import { INTRINSIC_TAG_PATTERN } from "./constants";
import { getSourceCandidate } from "./source-index";
import type {
  ComponentNodeRecord,
  ExportReference,
  FileRecord,
  GraphBuildState,
  ImportBinding,
  ResolveTargetResult,
  SupportedFunction,
} from "./types";

const resolveModuleRecord = (
  moduleName: string,
  containingFile: string,
  state: GraphBuildState
): { boundaryReason: string | null; record: FileRecord | null } => {
  const resolvedFileName = resolveModuleName(
    moduleName,
    containingFile,
    state.compilerOptions,
    state.host
  ).resolvedModule?.resolvedFileName;

  if (resolvedFileName) {
    const resolvedPath = path.resolve(resolvedFileName);

    if (!state.host.isPathAllowed(resolvedPath)) {
      return {
        boundaryReason: `Import ${moduleName} resolves outside the scan boundary.`,
        record: null,
      };
    }

    if (resolvedPath.includes(`${path.sep}node_modules${path.sep}`)) {
      return { boundaryReason: null, record: null };
    }

    const record = state.fileRecords.get(resolvedPath);
    if (record) {
      return { boundaryReason: null, record };
    }

    return {
      boundaryReason: `Import ${moduleName} resolved to a local script outside the indexed source set.`,
      record: null,
    };
  }

  if (moduleName.startsWith(".")) {
    const candidatePath = path.resolve(
      path.dirname(containingFile),
      moduleName
    );

    if (!state.host.isPathAllowed(candidatePath)) {
      return {
        boundaryReason: `Import ${moduleName} resolves outside the scan boundary.`,
        record: null,
      };
    }

    const record = getSourceCandidate(candidatePath, state.fileRecords);
    return {
      boundaryReason: record
        ? null
        : `Local import ${moduleName} could not be resolved in the indexed source set.`,
      record,
    };
  }

  if (moduleName.startsWith("@/")) {
    const record = getSourceCandidate(
      path.resolve(state.project.rootDir, moduleName.slice(2)),
      state.fileRecords
    );
    return {
      boundaryReason: record
        ? null
        : `Aliased import ${moduleName} could not be resolved in the indexed source set.`,
      record,
    };
  }

  return { boundaryReason: null, record: null };
};

const isSupportedFunctionNode = (node: Node): node is SupportedFunction =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node);

const getBindingScope = (
  component: ComponentNodeRecord
): SupportedFunction | null => {
  let candidate = component.declaration.parent;
  while (candidate) {
    if (isSupportedFunctionNode(candidate)) {
      return candidate;
    }
    candidate = candidate.parent;
  }

  return null;
};

const getLexicalDistance = (
  component: ComponentNodeRecord,
  owner: ComponentNodeRecord | null
): number | null => {
  const bindingScope = getBindingScope(component);
  if (!owner) {
    return bindingScope ? null : Number.MAX_SAFE_INTEGER;
  }

  if (component.id === owner.id) {
    return -1;
  }
  if (!bindingScope) {
    return Number.MAX_SAFE_INTEGER;
  }

  let distance = 0;
  let candidate: Node | undefined = owner.declaration;
  while (candidate) {
    if (candidate === bindingScope) {
      return distance;
    }
    if (candidate !== owner.declaration && isSupportedFunctionNode(candidate)) {
      distance += 1;
    }
    candidate = candidate.parent;
  }

  return null;
};

const getScopedLocalComponentIds = (
  record: FileRecord,
  localName: string,
  state: GraphBuildState,
  owner: ComponentNodeRecord | null
): string[] => {
  const candidates = record.localComponents.get(localName) ?? [];
  let closestDistance = Number.POSITIVE_INFINITY;
  const componentIds: string[] = [];

  for (const componentId of candidates) {
    const component = state.nodeRecords.get(componentId);
    if (!component) {
      continue;
    }

    const distance = getLexicalDistance(component, owner);
    if (distance === null || distance > closestDistance) {
      continue;
    }
    if (distance < closestDistance) {
      componentIds.length = 0;
      closestDistance = distance;
    }
    componentIds.push(componentId);
  }

  return componentIds;
};

const resolveLocalComponent = (
  record: FileRecord,
  localName: string,
  state: GraphBuildState,
  owner: ComponentNodeRecord | null = null
): ResolveTargetResult => {
  const componentIds = getScopedLocalComponentIds(
    record,
    localName,
    state,
    owner
  );

  if (componentIds.length !== 1) {
    return {
      boundaryReason:
        componentIds.length > 1
          ? `Local component ${localName} is ambiguous.`
          : `Local component ${localName} could not be resolved.`,
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  const target = state.nodeRecords.get(componentIds[0] ?? "") ?? null;
  return {
    boundaryReason: target ? null : `Local component ${localName} was omitted.`,
    potentialNavigation: record.potentialNavigation,
    resolution: target ? "resolved" : "unresolved",
    target,
  };
};

interface ExportResolutionTask {
  exportName: string;
  hops: number;
  record: FileRecord;
  visited: Set<string>;
}

interface ExportResolutionContext {
  boundaryReasons: Set<string>;
  hopBudget: number;
  potentialNavigation: boolean;
  rootExportName: string;
  sawExternalBranch: boolean;
  state: GraphBuildState;
  targets: Map<string, ComponentNodeRecord>;
  tasks: ExportResolutionTask[];
}

const createUnresolvedResult = (
  reason: string,
  potentialNavigation: boolean
): ResolveTargetResult => ({
  boundaryReason: reason,
  potentialNavigation,
  resolution: "unresolved",
  target: null,
});

const enqueueModuleResolution = (
  context: ExportResolutionContext,
  task: ExportResolutionTask,
  visited: Set<string>,
  moduleName: string,
  importedName: string
): void => {
  const moduleResult = resolveModuleRecord(
    moduleName,
    task.record.parsed.filePath,
    context.state
  );
  if (moduleResult.record) {
    context.tasks.push({
      exportName: importedName,
      hops: task.hops + 1,
      record: moduleResult.record,
      visited,
    });
  } else if (moduleResult.boundaryReason) {
    context.boundaryReasons.add(moduleResult.boundaryReason);
  } else {
    context.sawExternalBranch = true;
  }
};

const processExportStars = (
  context: ExportResolutionContext,
  task: ExportResolutionTask,
  visited: Set<string>
): void => {
  const exportStars = task.record.exportReferences.get("*") ?? [];
  if (exportStars.length === 0) {
    context.boundaryReasons.add(
      task.record.hasExportStar
        ? `Export ${task.exportName} depends on an unsupported export-star declaration.`
        : `Export ${task.exportName} could not be resolved.`
    );
    context.potentialNavigation ||= task.record.hasExportStar;
    return;
  }

  context.potentialNavigation = true;
  for (const exportStar of exportStars) {
    if (exportStar.kind === "reexport") {
      enqueueModuleResolution(
        context,
        task,
        visited,
        exportStar.moduleName,
        task.exportName
      );
    }
  }
};

const processComponentReference = (
  context: ExportResolutionContext,
  task: ExportResolutionTask,
  reference: Extract<ExportReference, { kind: "component" }>
): void => {
  const target = context.state.nodeRecords.get(reference.componentId);
  if (target) {
    context.targets.set(target.id, target);
    return;
  }

  context.boundaryReasons.add(
    `Export ${task.exportName} references an omitted component.`
  );
};

const processLocalReference = (
  context: ExportResolutionContext,
  task: ExportResolutionTask,
  visited: Set<string>,
  reference: Extract<ExportReference, { kind: "local" }>
): void => {
  const localResult = resolveLocalComponent(
    task.record,
    reference.localName,
    context.state
  );
  if (localResult.target) {
    context.targets.set(localResult.target.id, localResult.target);
    return;
  }

  const binding = task.record.imports.get(reference.localName);
  if (!binding || binding.kind === "namespace" || !binding.importedName) {
    context.boundaryReasons.add(
      localResult.boundaryReason ??
        `Local component ${reference.localName} could not be resolved.`
    );
    return;
  }

  enqueueModuleResolution(
    context,
    task,
    visited,
    binding.moduleName,
    binding.importedName
  );
};

const processExportReference = (
  context: ExportResolutionContext,
  task: ExportResolutionTask,
  visited: Set<string>,
  reference: ExportReference
): void => {
  if (reference.kind === "component") {
    processComponentReference(context, task, reference);
    return;
  }

  if (reference.kind === "local") {
    processLocalReference(context, task, visited, reference);
    return;
  }

  enqueueModuleResolution(
    context,
    task,
    visited,
    reference.moduleName,
    reference.importedName
  );
};

const processExportTask = (
  context: ExportResolutionContext,
  task: ExportResolutionTask
): void => {
  context.potentialNavigation ||= task.record.potentialNavigation;
  const visitKey = JSON.stringify([
    task.record.parsed.filePath,
    task.exportName,
  ]);
  if (task.visited.has(visitKey)) {
    context.boundaryReasons.add(
      `Export cycle reached while resolving ${task.exportName}.`
    );
    context.potentialNavigation = true;
    return;
  }

  if (task.hops >= context.hopBudget) {
    context.boundaryReasons.add(
      `Export resolution hop limit (${context.hopBudget}) was reached while resolving ${context.rootExportName}.`
    );
    context.potentialNavigation = true;
    return;
  }

  const visited = new Set(task.visited);
  visited.add(visitKey);
  const references = task.record.exportReferences.get(task.exportName) ?? [];
  if (references.length > 1) {
    context.boundaryReasons.add(`Export ${task.exportName} is ambiguous.`);
    context.potentialNavigation = true;
    return;
  }

  const reference = references[0];
  if (reference) {
    processExportReference(context, task, visited, reference);
  } else {
    processExportStars(context, task, visited);
  }
};

const finalizeExportResolution = (
  context: ExportResolutionContext
): ResolveTargetResult => {
  if (
    context.targets.size === 1 &&
    context.boundaryReasons.size === 0 &&
    !context.sawExternalBranch
  ) {
    return {
      boundaryReason: null,
      potentialNavigation: context.potentialNavigation,
      resolution: "resolved",
      target: context.targets.values().next().value ?? null,
    };
  }

  if (context.targets.size > 1) {
    context.boundaryReasons.add(
      `Export ${context.rootExportName} is ambiguous.`
    );
  }
  if (context.sawExternalBranch) {
    context.boundaryReasons.add(
      `Export ${context.rootExportName} may be provided by an external re-export declaration.`
    );
  }
  if (context.targets.size === 1 && context.boundaryReasons.size > 0) {
    context.boundaryReasons.add(
      `Export ${context.rootExportName} is only partially resolved.`
    );
  }

  const reason = [...context.boundaryReasons].sort(compareCodeUnits)[0];
  return createUnresolvedResult(
    reason ?? `Export ${context.rootExportName} could not be resolved.`,
    context.potentialNavigation
  );
};

const resolveExport = (
  record: FileRecord,
  exportName: string,
  state: GraphBuildState,
  visited: Set<string> = new Set()
): ResolveTargetResult => {
  const context: ExportResolutionContext = {
    boundaryReasons: new Set(),
    hopBudget: Math.max(1, state.limits.maxDepth),
    potentialNavigation: false,
    rootExportName: exportName,
    sawExternalBranch: false,
    state,
    targets: new Map(),
    tasks: [{ exportName, hops: 0, record, visited }],
  };

  for (const task of context.tasks) {
    processExportTask(context, task);
  }

  return finalizeExportResolution(context);
};

function resolveImportedBinding(
  record: FileRecord,
  binding: ImportBinding,
  importedName: string,
  state: GraphBuildState,
  visited: Set<string> = new Set()
): ResolveTargetResult {
  const moduleResult = resolveModuleRecord(
    binding.moduleName,
    record.parsed.filePath,
    state
  );

  if (!moduleResult.record) {
    return {
      boundaryReason: moduleResult.boundaryReason,
      potentialNavigation: Boolean(moduleResult.boundaryReason),
      resolution: moduleResult.boundaryReason ? "unresolved" : "external",
      target: null,
    };
  }

  const exportResult = resolveExport(
    moduleResult.record,
    importedName,
    state,
    visited
  );
  return {
    ...exportResult,
    potentialNavigation:
      exportResult.potentialNavigation ||
      moduleResult.record.potentialNavigation,
  };
}

const resolveElementTarget = (
  record: FileRecord,
  tagName: string,
  state: GraphBuildState,
  owner: ComponentNodeRecord | null = null
): ResolveTargetResult => {
  const [rootName, memberName, ...remaining] = tagName.split(".");

  if (!rootName) {
    return {
      boundaryReason: "A dynamic JSX tag could not be resolved.",
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  if (!memberName && INTRINSIC_TAG_PATTERN.test(rootName)) {
    return { boundaryReason: null, resolution: "intrinsic", target: null };
  }

  if (memberName) {
    const binding = record.imports.get(rootName);

    if (!(binding && binding.kind === "namespace" && remaining.length === 0)) {
      return {
        boundaryReason: `Dynamic component ${tagName} could not be resolved.`,
        potentialNavigation: record.potentialNavigation,
        resolution: "unresolved",
        target: null,
      };
    }

    return resolveImportedBinding(record, binding, memberName, state);
  }

  const localComponentIds = getScopedLocalComponentIds(
    record,
    rootName,
    state,
    owner
  );
  if (localComponentIds.length > 0) {
    return resolveLocalComponent(record, rootName, state, owner);
  }

  const binding = record.imports.get(rootName);
  if (!binding && rootName === "NavigationMenu") {
    return { boundaryReason: null, resolution: "external", target: null };
  }

  if (!binding) {
    return {
      boundaryReason: `Dynamic or local component ${rootName} could not be resolved.`,
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  if (binding.kind === "namespace" || !binding.importedName) {
    return {
      boundaryReason: `Namespace component ${rootName} needs a static member.`,
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  return resolveImportedBinding(record, binding, binding.importedName, state);
};

const getRecordDefault = (
  record: FileRecord,
  state: GraphBuildState
): ComponentNodeRecord | null => {
  const resolved = resolveExport(record, "default", state);
  return resolved.resolution === "resolved" ? resolved.target : null;
};

const getRecordNamed = (
  record: FileRecord,
  name: string,
  state: GraphBuildState
): ComponentNodeRecord | null => {
  const localResult = resolveLocalComponent(record, name, state);
  if (localResult.target) {
    return localResult.target;
  }

  const exportResult = resolveExport(record, name, state);
  return exportResult.resolution === "resolved" ? exportResult.target : null;
};

const getRecord = (
  filePath: string,
  state: GraphBuildState
): FileRecord | null => state.fileRecords.get(path.resolve(filePath)) ?? null;

export { getRecord, getRecordDefault, getRecordNamed, resolveElementTarget };
