import {
  type ComponentAnatomyManifest,
  evaluateComponentAnatomy,
} from "../anatomy";
import { parseProjectSourceFiles } from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable, pass } from "./rule-result";

const ALERT_MANIFEST: ComponentAnatomyManifest = {
  allowIcon: true,
  component: "Alert",
  forbidden: [],
  moduleFile: "alert",
  requiredParts: ["AlertTitle"],
};

const alertAnatomyRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "medium",
  description:
    "Checks that Alert is composed from its anatomy: at most one icon, a required AlertTitle, and parts exported by the project's alert module.",
  id: "alert-anatomy",
  maxScore: 0,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const evaluation = evaluateComponentAnatomy(
      files,
      project.shadcn.aliases.ui,
      ALERT_MANIFEST
    );

    if (evaluation.violation) {
      return advisory(
        evaluation.violation.message,
        evaluation.violation.remediation,
        evaluation.violation.filePath,
        evaluation.violation.line
      );
    }

    if (evaluation.instances === 0) {
      return notApplicable("No Alert compositions were found.");
    }

    if (evaluation.uncertainInstances === evaluation.instances) {
      return notApplicable(
        "Alert children are dynamic; anatomy cannot be established statically."
      );
    }

    return pass(
      `All ${evaluation.instances - evaluation.uncertainInstances} statically provable Alert compositions match the Alert anatomy.`
    );
  },
  severity: "warning",
  title: "Alert matches its anatomy",
};

export { alertAnatomyRule };
