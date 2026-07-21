import type { ComponentRenderGraphLimits } from "./types";

// These limits bound graph construction and route expansion over untrusted code.
const DEFAULT_COMPONENT_RENDER_GRAPH_LIMITS = {
  maxDepth: 32,
  maxEdges: 16_384,
  maxGuardAtomsPerPath: 32,
  maxInstancesPerSurface: 2048,
  maxNodes: 4096,
  maxSurfaces: 512,
  maxTotalInstances: 32_768,
} as const satisfies ComponentRenderGraphLimits;

const MODULE_CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;
const SCRIPT_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;
const APP_PAGE_PATTERN = /^page\.[jt]sx?$/;
const APP_LAYOUT_NAMES = [
  "layout.tsx",
  "layout.jsx",
  "layout.ts",
  "layout.js",
] as const;
const APP_TEMPLATE_NAMES = [
  "template.tsx",
  "template.jsx",
  "template.ts",
  "template.js",
] as const;
const NEXT_INTERCEPTION_SEGMENT_PATTERN = /^\((?:\.{1,3})\)/;
const POTENTIAL_NAVIGATION_NAME_PATTERN = /(?:^|\.)(?:Nav|Navbar|Navigation)/;
const INTRINSIC_TAG_PATTERN = /^[a-z]/;
const ROUTE_GROUP_SEGMENT_PATTERN = /^\(.+\)$/;
const TRAILING_SLASH_PATTERN = /\/$/;
const GET_LAYOUT_PATTERN = /\bgetLayout\b/;
const TRANSPARENT_ROOT_COMPONENTS = new Set(["React.StrictMode", "StrictMode"]);

export {
  APP_LAYOUT_NAMES,
  APP_PAGE_PATTERN,
  APP_TEMPLATE_NAMES,
  DEFAULT_COMPONENT_RENDER_GRAPH_LIMITS,
  GET_LAYOUT_PATTERN,
  INTRINSIC_TAG_PATTERN,
  MODULE_CANDIDATE_SUFFIXES,
  NEXT_INTERCEPTION_SEGMENT_PATTERN,
  POTENTIAL_NAVIGATION_NAME_PATTERN,
  ROUTE_GROUP_SEGMENT_PATTERN,
  SCRIPT_EXTENSION_PATTERN,
  TRAILING_SLASH_PATTERN,
  TRANSPARENT_ROOT_COMPONENTS,
};
