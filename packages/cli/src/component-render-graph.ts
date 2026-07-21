import { parseProjectSourceFiles } from "./ast";
import { DEFAULT_COMPONENT_RENDER_GRAPH_LIMITS as DEFAULT_LIMITS } from "./component-render-graph/constants";
import {
  guardsCanCoexist as canGuardsCoexist,
  expandSurfacePlan,
} from "./component-render-graph/expansion";
import { createGraphBuildState } from "./component-render-graph/source-index";
import { createSurfacePlans } from "./component-render-graph/surface-planning";
import { buildTemplates } from "./component-render-graph/template-extraction";
import type {
  BuildComponentRenderGraphOptions as InternalBuildGraphOptions,
  ComponentGraphEdge as InternalComponentGraphEdge,
  ComponentGraphNode as InternalComponentGraphNode,
  ComponentId as InternalComponentId,
  ComponentRenderGraphLimits as InternalGraphLimits,
  ComponentRenderGraphMetrics as InternalGraphMetrics,
  RenderedJsxInstance as InternalRenderedJsxInstance,
  ComponentRenderGraph as InternalRenderGraph,
  RenderGuard as InternalRenderGuard,
  ComponentRenderSurface as InternalRenderSurface,
} from "./component-render-graph/types";
import { compareCodeUnits } from "./deterministic-order";
import type { ProjectDiscovery } from "./discovery";

type BuildComponentRenderGraphOptions = InternalBuildGraphOptions;
type ComponentGraphEdge = InternalComponentGraphEdge;
type ComponentGraphNode = InternalComponentGraphNode;
type ComponentId = InternalComponentId;
type ComponentRenderGraph = InternalRenderGraph;
type ComponentRenderGraphLimits = InternalGraphLimits;
type ComponentRenderGraphMetrics = InternalGraphMetrics;
type ComponentRenderSurface = InternalRenderSurface;
type RenderedJsxInstance = InternalRenderedJsxInstance;
type RenderGuard = InternalRenderGuard;

const DEFAULT_COMPONENT_RENDER_GRAPH_LIMITS = DEFAULT_LIMITS;
const guardsCanCoexist = canGuardsCoexist;

const buildComponentRenderGraph = async (
  project: ProjectDiscovery,
  filesystemRoot: string,
  options: BuildComponentRenderGraphOptions = {}
): Promise<ComponentRenderGraph> => {
  const limits = {
    ...DEFAULT_LIMITS,
    ...options.limits,
  };
  const graphBoundaryReasons = new Set<string>();
  const parsedFiles = await parseProjectSourceFiles(project);
  const { nodes, state: buildState } = createGraphBuildState(
    project,
    filesystemRoot,
    parsedFiles,
    limits,
    graphBoundaryReasons
  );
  buildTemplates(buildState);
  const plans = createSurfacePlans(buildState);

  if (plans.length === 0) {
    graphBoundaryReasons.add("No recognizable render surfaces were found.");
  }

  const totalInstances = { value: 0 };
  const surfaces = plans.map((plan) =>
    expandSurfacePlan(plan, buildState, totalInstances)
  );

  if (project.sourceCoverage === "partial") {
    graphBoundaryReasons.add("Project source coverage is partial.");
  }

  return {
    boundaryReasons: [...graphBoundaryReasons].sort(compareCodeUnits),
    edges: [...buildState.edges],
    limits,
    metrics: { ...buildState.metrics },
    nodes: nodes.map(
      ({
        childrenProjection,
        classNameForwarding,
        declarationStart,
        exportNames,
        filePath,
        id,
        localName,
        projectsChildren,
      }) => ({
        childrenProjection,
        classNameForwarding,
        declarationStart,
        exportNames: [...exportNames],
        filePath,
        id,
        localName,
        projectsChildren,
      })
    ),
    surfaces,
  };
};

export type {
  BuildComponentRenderGraphOptions,
  ComponentGraphEdge,
  ComponentGraphNode,
  ComponentId,
  ComponentRenderGraph,
  ComponentRenderGraphLimits,
  ComponentRenderGraphMetrics,
  ComponentRenderSurface,
  RenderedJsxInstance,
  RenderGuard,
};
export {
  buildComponentRenderGraph,
  DEFAULT_COMPONENT_RENDER_GRAPH_LIMITS,
  guardsCanCoexist,
};
