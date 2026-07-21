import type { GraphBuildState, SurfacePlan } from "./types";

const addSurfacePlan = (
  state: GraphBuildState,
  plans: SurfacePlan[],
  plan: SurfacePlan
): boolean => {
  state.metrics.surfaceCandidatesVisited += 1;

  if (plans.length >= state.limits.maxSurfaces) {
    state.graphBoundaryReasons.add(
      `Component render surface limit (${state.limits.maxSurfaces}) was reached.`
    );
    state.surfacePlanningHalted = true;
    return false;
  }

  plans.push(plan);
  state.metrics.surfacePlansCreated += 1;
  return true;
};

export { addSurfacePlan };
