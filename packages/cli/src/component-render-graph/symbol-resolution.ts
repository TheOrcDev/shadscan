import path from "node:path";
import { resolveModuleName } from "typescript";
import { INTRINSIC_TAG_PATTERN } from "./constants";
import { getSourceCandidate } from "./source-index";
import type {
  ComponentNodeRecord,
  FileRecord,
  GraphBuildState,
  ImportBinding,
  ResolveTargetResult,
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

const resolveLocalComponent = (
  record: FileRecord,
  localName: string,
  state: GraphBuildState
): ResolveTargetResult => {
  const componentIds = record.localComponents.get(localName) ?? [];

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

function resolveExport(
  record: FileRecord,
  exportName: string,
  state: GraphBuildState,
  visited: Set<string> = new Set()
): ResolveTargetResult {
  const visitKey = JSON.stringify([record.parsed.filePath, exportName]);

  if (visited.has(visitKey)) {
    return {
      boundaryReason: `Export cycle reached while resolving ${exportName}.`,
      resolution: "unresolved",
      target: null,
    };
  }

  const references = record.exportReferences.get(exportName) ?? [];

  if (references.length !== 1) {
    let reason = `Export ${exportName} could not be resolved.`;

    if (references.length > 1) {
      reason = `Export ${exportName} is ambiguous.`;
    } else if (record.hasExportStar) {
      reason = `Export ${exportName} depends on an unsupported export-star declaration.`;
    }
    return {
      boundaryReason: reason,
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  const reference = references[0];
  if (!reference) {
    return {
      boundaryReason: `Export ${exportName} could not be resolved.`,
      resolution: "unresolved",
      target: null,
    };
  }

  if (reference.kind === "component") {
    const target = state.nodeRecords.get(reference.componentId) ?? null;
    return {
      boundaryReason: target
        ? null
        : `Export ${exportName} references an omitted component.`,
      potentialNavigation: record.potentialNavigation,
      resolution: target ? "resolved" : "unresolved",
      target,
    };
  }

  if (reference.kind === "local") {
    const localResult = resolveLocalComponent(
      record,
      reference.localName,
      state
    );
    const binding = record.imports.get(reference.localName);

    if (
      localResult.target ||
      !binding ||
      binding.kind === "namespace" ||
      !binding.importedName
    ) {
      return localResult;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(visitKey);
    return resolveImportedBinding(
      record,
      binding,
      binding.importedName,
      state,
      nextVisited
    );
  }

  const moduleResult = resolveModuleRecord(
    reference.moduleName,
    record.parsed.filePath,
    state
  );
  if (!moduleResult.record) {
    return {
      boundaryReason:
        moduleResult.boundaryReason ??
        `Re-export ${reference.moduleName} is external or unresolved.`,
      potentialNavigation: record.potentialNavigation,
      resolution: "unresolved",
      target: null,
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(visitKey);
  return resolveExport(
    moduleResult.record,
    reference.importedName,
    state,
    nextVisited
  );
}

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
  state: GraphBuildState
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

  const localComponents = record.localComponents.get(rootName);
  if (localComponents) {
    return resolveLocalComponent(record, rootName, state);
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
