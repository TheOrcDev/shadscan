import type {
  ArrowFunction,
  CompilerOptions,
  FunctionDeclaration,
  FunctionExpression,
  JsxOpeningLikeElement,
} from "typescript";
import type { ParsedSourceFile } from "../ast";
import type { FrameworkAdapter, ProjectDiscovery } from "../discovery";
import type { ResponsiveVisibility } from "../rules/responsive-visibility";
import type { ConfinedTypeScriptHost } from "../typescript-host";

type ComponentId = string;
type ChildrenProjection = "ignored" | "projected" | "unknown";
type ClassNameForwarding = "forwarded" | "ignored" | "unknown";
type RenderMultiplicity = "one" | "unknown";
type RenderResolution = "external" | "intrinsic" | "resolved" | "unresolved";
type RenderSurfaceAdapter = Exclude<FrameworkAdapter, "next-hybrid-router">;

interface ComponentRenderGraphLimits {
  maxDepth: number;
  maxEdges: number;
  maxGuardAtomsPerPath: number;
  maxInstancesPerSurface: number;
  maxNodes: number;
  maxSurfaces: number;
  maxTotalInstances: number;
}

interface RenderGuard {
  branch: "falsy" | "truthy";
  id: string;
  referencedNames?: string[];
}

interface ComponentGraphNode {
  childrenProjection: ChildrenProjection;
  classNameForwarding: ClassNameForwarding;
  declarationStart: number;
  exportNames: string[];
  filePath: string;
  id: ComponentId;
  localName: string | null;
  projectsChildren: boolean;
}

interface ComponentGraphEdge {
  callsiteStart: number;
  filePath: string;
  from: ComponentId;
  id: string;
  line: number;
  multiplicity: RenderMultiplicity;
  resolution: RenderResolution;
  tagName: string;
  target: ComponentId | null;
}

interface RenderedJsxInstance {
  componentId: ComponentId;
  edgeId: string;
  file: ParsedSourceFile;
  guards: RenderGuard[];
  id: string;
  line: number;
  multiplicity: RenderMultiplicity;
  node: JsxOpeningLikeElement;
  resolution: RenderResolution;
  resolvedTargetFilePath: string | null;
  surfaceId: string;
  tagName: string;
  uncertaintyReasons: string[];
  visibility: ResponsiveVisibility;
}

interface ComponentRenderSurface {
  adapter: RenderSurfaceAdapter;
  boundaryReasons: string[];
  completeness: "complete" | "partial";
  id: string;
  instances: RenderedJsxInstance[];
  routeKey: string;
}

interface ComponentRenderGraph {
  boundaryReasons: string[];
  edges: ComponentGraphEdge[];
  limits: ComponentRenderGraphLimits;
  metrics: ComponentRenderGraphMetrics;
  nodes: ComponentGraphNode[];
  surfaces: ComponentRenderSurface[];
}

interface BuildComponentRenderGraphOptions {
  limits?: Partial<ComponentRenderGraphLimits>;
}

interface ChildrenBindings {
  objectName: string | null;
  valueNames: Set<string>;
}

interface ComponentRenderGraphMetrics {
  edgeTruncationMarkers: number;
  navigationReachabilityEvaluations: number;
  surfaceCandidatesVisited: number;
  surfacePlansCreated: number;
  templateNodesVisited: number;
}

interface ComponentNodeRecord extends ComponentGraphNode {
  childrenBindings: ChildrenBindings;
  classNameBindings: ChildrenBindings;
  declaration: SupportedFunction;
  file: ParsedSourceFile;
  template: RenderTemplateItem[];
}

type SupportedFunction =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression;

interface ImportBinding {
  importedName: string | null;
  kind: "binding" | "namespace";
  moduleName: string;
}

type ExportReference =
  | { componentId: ComponentId; kind: "component" }
  | { kind: "local"; localName: string }
  | { importedName: string; kind: "reexport"; moduleName: string };

interface FileRecord {
  exportReferences: Map<string, ExportReference[]>;
  hasExportStar: boolean;
  imports: Map<string, ImportBinding>;
  localComponents: Map<string, ComponentId[]>;
  parsed: ParsedSourceFile;
  potentialNavigation: boolean;
}

interface ResolveTargetResult {
  boundaryReason: string | null;
  potentialNavigation?: boolean;
  resolution: RenderResolution;
  target: ComponentNodeRecord | null;
}

interface RenderElementTemplate {
  children: RenderTemplateItem[];
  edge: ComponentGraphEdge;
  file: ParsedSourceFile;
  guards: RenderGuard[];
  hasMeaningfulCallsiteVisibility: boolean;
  kind: "element";
  literalControlPropNames: string[];
  localVisibility: ResponsiveVisibility;
  node: JsxOpeningLikeElement;
  relevantBoundaryReason: string | null;
  uncertaintyReasons: string[];
  usesForwardedClassName: boolean;
}

interface RenderProjectionTemplate {
  guards: RenderGuard[];
  id: string;
  kind: "children-projection";
  uncertaintyReasons: string[];
}

interface RenderOpaqueTemplate {
  guards: RenderGuard[];
  id: string;
  kind: "opaque";
  reason: string;
  relevant: boolean;
}

type RenderTemplateItem =
  | RenderElementTemplate
  | RenderOpaqueTemplate
  | RenderProjectionTemplate;

interface TemplateContext {
  guards: RenderGuard[];
  multiplicity: RenderMultiplicity;
  uncertaintyReasons: string[];
}

interface ComponentSeed {
  componentId: ComponentId;
  projectedChildren: ProjectionContent | null;
}

type ProjectionContent =
  | {
      items: RenderTemplateItem[];
      kind: "template";
      projectedChildren: ProjectionContent | null;
    }
  | { kind: "component"; seed: ComponentSeed };

interface SurfacePlan {
  adapter: RenderSurfaceAdapter;
  boundaryReasons: string[];
  dynamicComponent: ComponentSeed | null;
  id: string;
  roots: ComponentSeed[];
  routeKey: string;
}

interface PagesAppContext {
  appNode: ComponentNodeRecord | null;
  appRecord: FileRecord | null;
  rendersComponent: boolean;
}

interface ExpansionState {
  activeComponents: ComponentId[];
  dynamicComponent: ComponentSeed | null;
  forwardedClassNameVisibility: ResponsiveVisibility | null;
  graphBoundaryReasons: Set<string>;
  guards: RenderGuard[];
  halted: boolean;
  path: string[];
  surface: ComponentRenderSurface;
  totalInstances: { value: number };
  uncertaintyReasons: string[];
  visibility: ResponsiveVisibility;
}

interface GraphBuildState {
  compilerOptions: CompilerOptions;
  edges: ComponentGraphEdge[];
  edgeTraversalHalted: boolean;
  fileRecords: Map<string, FileRecord>;
  graphBoundaryReasons: Set<string>;
  host: ConfinedTypeScriptHost;
  limits: ComponentRenderGraphLimits;
  metrics: ComponentRenderGraphMetrics;
  navigationReachability: Map<ComponentId, "no" | "unknown" | "yes">;
  navigationReachabilityInitialized: boolean;
  nodeRecords: Map<ComponentId, ComponentNodeRecord>;
  project: ProjectDiscovery;
  surfacePlanningHalted: boolean;
}

interface GuardAppendResult {
  guards: RenderGuard[];
  truncated: boolean;
}

export type {
  BuildComponentRenderGraphOptions,
  ChildrenBindings,
  ChildrenProjection,
  ClassNameForwarding,
  ComponentGraphEdge,
  ComponentGraphNode,
  ComponentId,
  ComponentNodeRecord,
  ComponentRenderGraph,
  ComponentRenderGraphLimits,
  ComponentRenderGraphMetrics,
  ComponentRenderSurface,
  ComponentSeed,
  ExpansionState,
  ExportReference,
  FileRecord,
  GraphBuildState,
  GuardAppendResult,
  ImportBinding,
  PagesAppContext,
  ProjectionContent,
  RenderElementTemplate,
  RenderedJsxInstance,
  RenderGuard,
  RenderMultiplicity,
  RenderOpaqueTemplate,
  RenderProjectionTemplate,
  RenderResolution,
  RenderSurfaceAdapter,
  RenderTemplateItem,
  ResolveTargetResult,
  SupportedFunction,
  SurfacePlan,
  TemplateContext,
};
