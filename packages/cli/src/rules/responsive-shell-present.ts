import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const SHELL_PATH_PATTERN =
  /[/\\](?:app|app-shell|layout|root-layout|shell)\.(?:jsx|tsx)$/i;
const SHELL_CONTENT_PATTERN =
  /(?:function|const)\s+(?:App|AppShell|Layout|RootLayout|Shell)\b|<(?:header|main|nav)\b/;
const RESPONSIVE_PATTERN =
  /(?:^|[\s"'`])(?:sm|md|lg|xl|2xl):|@media\s*\(|matchMedia\s*\(|useMediaQuery\s*\(/m;

const responsiveShellPresentRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "low",
  description:
    "Looks for responsive breakpoint behavior in the application's top-level shell.",
  id: "responsive-shell-present",
  maxScore: 0,
  run: async ({ project }) => {
    const files = await getProjectSourceFiles(project);
    const shellFile = files.find(
      (file) =>
        SHELL_PATH_PATTERN.test(file.path) ||
        SHELL_CONTENT_PATTERN.test(file.content)
    );

    if (!shellFile) {
      return notApplicable(
        "No app-level shell could be identified statically."
      );
    }

    const responsiveFile = files.find((file) =>
      RESPONSIVE_PATTERN.test(file.content)
    );

    if (responsiveFile) {
      return pass(
        "Responsive shell behavior is present in source.",
        responsiveFile.path,
        getTextLineNumber(responsiveFile.content, RESPONSIVE_PATTERN)
      );
    }

    return fail(
      "An app shell was found without breakpoint or media-query evidence.",
      "Add deliberate small-screen shell behavior, then verify navigation, content width, and stacking at mobile and desktop viewports.",
      {
        filePath: shellFile.path,
        line: getTextLineNumber(shellFile.content, SHELL_CONTENT_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "the application shell adapts across viewports",
};

export { responsiveShellPresentRule };
