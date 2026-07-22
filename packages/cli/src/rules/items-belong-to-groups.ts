import {
  type AnatomyContainerContract,
  evaluateContainerContracts,
} from "../anatomy";
import { parseProjectSourceFiles } from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable, pass } from "./rule-result";

const CONTAINER_CONTRACTS: readonly AnatomyContainerContract[] = [
  {
    contextComponent: "SelectContent",
    groupComponent: "SelectGroup",
    itemComponent: "SelectItem",
    moduleFile: "select",
  },
  {
    contextComponent: "DropdownMenuContent",
    groupComponent: "DropdownMenuGroup",
    itemComponent: "DropdownMenuItem",
    moduleFile: "dropdown-menu",
  },
  {
    contextComponent: "CommandList",
    groupComponent: "CommandGroup",
    itemComponent: "CommandItem",
    moduleFile: "command",
  },
];

const itemsBelongToGroupsRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks that Select, DropdownMenu, and Command items are composed inside their matching group parts.",
  id: "items-belong-to-groups",
  maxScore: 0,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const evaluation = evaluateContainerContracts(
      files,
      project.shadcn.aliases.ui,
      CONTAINER_CONTRACTS
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
      return notApplicable(
        "No Select, DropdownMenu, or Command items were found."
      );
    }

    if (evaluation.uncertainInstances === evaluation.instances) {
      return notApplicable(
        "Item grouping is composed across component boundaries that static analysis cannot follow."
      );
    }

    return pass(
      `All ${evaluation.instances - evaluation.uncertainInstances} statically provable items sit inside their group parts.`
    );
  },
  severity: "warning",
  title: "items are composed inside their groups",
};

export { itemsBelongToGroupsRule };
