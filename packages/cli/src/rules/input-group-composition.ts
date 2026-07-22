import {
  type ComponentAnatomyManifest,
  evaluateComponentAnatomy,
} from "../anatomy";
import { parseProjectSourceFiles } from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable, pass } from "./rule-result";

const INPUT_GROUP_MANIFEST: ComponentAnatomyManifest = {
  allowIcon: false,
  component: "InputGroup",
  forbidden: [
    {
      component: "Input",
      moduleFile: "input",
      remediation:
        "Use InputGroupInput instead of a raw Input inside InputGroup.",
    },
    {
      component: "Textarea",
      moduleFile: "textarea",
      remediation:
        "Use InputGroupTextarea instead of a raw Textarea inside InputGroup.",
    },
    {
      component: "Button",
      moduleFile: "button",
      remediation:
        "Place buttons inside an InputGroupAddon (or use InputGroupButton) instead of a raw Button inside InputGroup.",
    },
    {
      component: "a native input",
      moduleFile: null,
      nativeTag: "input",
      remediation:
        "Use InputGroupInput instead of a native input inside InputGroup.",
    },
    {
      component: "a native textarea",
      moduleFile: null,
      nativeTag: "textarea",
      remediation:
        "Use InputGroupTextarea instead of a native textarea inside InputGroup.",
    },
    {
      component: "a native button",
      moduleFile: null,
      nativeTag: "button",
      remediation:
        "Place buttons inside an InputGroupAddon instead of a native button inside InputGroup.",
    },
  ],
  moduleFile: "input-group",
  requiredParts: [],
};

const inputGroupCompositionRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description:
    "Checks that InputGroup is composed from its own input, textarea, and addon parts rather than raw controls.",
  id: "input-group-composition",
  maxScore: 0,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const evaluation = evaluateComponentAnatomy(
      files,
      project.shadcn.aliases.ui,
      INPUT_GROUP_MANIFEST
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
      return notApplicable("No InputGroup compositions were found.");
    }

    return pass(
      `All ${evaluation.instances} InputGroup compositions use InputGroup parts.`
    );
  },
  severity: "warning",
  title: "InputGroup uses its own parts",
};

export { inputGroupCompositionRule };
