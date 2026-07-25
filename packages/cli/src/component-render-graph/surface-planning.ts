import { compareCodeUnits } from "../deterministic-order";
import { addAstroSurfacePlans } from "./astro-surface-planning";
import { addClientSurfacePlan } from "./client-surface-planning";
import { addInertiaSurfacePlans } from "./inertia-surface-planning";
import {
  addAppSurfacePlans,
  addNextConfigBoundary,
  addPagesSurfacePlans,
} from "./next-surface-planning";
import { addReactRouterSurfacePlans } from "./react-router-surface-planning";
import { addStartSurfacePlans } from "./start-surface-planning";
import type { GraphBuildState, SurfacePlan } from "./types";

const createSurfacePlans = async (
  state: GraphBuildState
): Promise<SurfacePlan[]> => {
  const adapter = state.project.framework.adapter;
  const plans: SurfacePlan[] = [];

  if (adapter.startsWith("next-")) {
    addNextConfigBoundary(state);
  }

  if (adapter === "next-app-router" || adapter === "next-hybrid-router") {
    addAppSurfacePlans(state, plans);
  }

  if (adapter === "next-pages-router" || adapter === "next-hybrid-router") {
    addPagesSurfacePlans(state, plans);
  }

  if (adapter === "tanstack-start") {
    addStartSurfacePlans(state, plans);
  }

  if (adapter === "laravel-inertia-react") {
    addInertiaSurfacePlans(state, plans);
  }

  if (adapter === "astro-react") {
    await addAstroSurfacePlans(state, plans);
  }

  if (adapter === "react-router-framework") {
    addReactRouterSurfacePlans(state, plans);
  }

  addClientSurfacePlan(state, plans);
  return plans.sort((left, right) => compareCodeUnits(left.id, right.id));
};

export { createSurfacePlans };
