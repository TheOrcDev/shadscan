import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

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
    const files = await getProjectSourceFiles(project);
    const statusFile = files.find((file) =>
      DYNAMIC_STATUS_PATTERN.test(file.content)
    );

    if (!statusFile) {
      return notApplicable("No recognizable dynamic status message was found.");
    }

    const announcementFile = files.find((file) =>
      ANNOUNCEMENT_PATTERN.test(file.content)
    );

    if (announcementFile) {
      return pass(
        "Dynamic status messaging has a programmatic announcement channel.",
        announcementFile.path,
        getTextLineNumber(announcementFile.content, ANNOUNCEMENT_PATTERN)
      );
    }

    return fail(
      "Dynamic status messages have no live region or accessible toast channel.",
      "Render updates in role=status/alert or aria-live, or deliver them through mounted accessible toast infrastructure.",
      {
        filePath: statusFile.path,
        line: getTextLineNumber(statusFile.content, DYNAMIC_STATUS_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "status messages are announced",
};

export { statusMessagesAnnouncedRule };
