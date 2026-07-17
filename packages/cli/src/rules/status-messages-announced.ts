import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const DYNAMIC_STATUS_PATTERN =
  /\b(?:setStatus|setMessage|statusMessage|successMessage|errorMessage|progressMessage)\b|\b(?:isPending|isLoading)\s*\?/;
const ANNOUNCEMENT_PATTERN =
  /role\s*=\s*["'](?:status|alert)["']|aria-live\s*=|<(?:Toaster|ToastProvider)(?:\s|>)|\btoast(?:\.|\s*\()/;

const statusMessagesAnnouncedRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "medium",
  description:
    "Checks dynamic status messages for a live region or accessible toast channel.",
  id: "status-messages-announced",
  maxScore: 3,
  run: async ({ project }) => {
    const statusScopes = await findOwnedSourceScopes(
      project,
      DYNAMIC_STATUS_PATTERN
    );

    if (statusScopes.length === 0) {
      return notApplicable("No recognizable dynamic status message was found.");
    }

    for (const scope of statusScopes) {
      if (ANNOUNCEMENT_PATTERN.test(scope.content)) {
        continue;
      }

      return fail(
        "A dynamic status message has no local live region or accessible toast channel.",
        "Render updates in role=status/alert or aria-live, or deliver them through mounted accessible toast infrastructure.",
        {
          filePath: scope.file.filePath,
          line: scope.line,
        }
      );
    }

    const firstScope = statusScopes[0];
    return pass(
      "Dynamic status messaging has a programmatic announcement channel.",
      firstScope?.file.filePath,
      firstScope?.line
    );
  },
  severity: "warning",
  title: "status messages are announced",
};

export { statusMessagesAnnouncedRule };
