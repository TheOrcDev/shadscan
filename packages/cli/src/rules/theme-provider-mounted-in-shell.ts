import path from "node:path";
import type { AuditContext, AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getTextLineNumber, readProjectSourceFile } from "./source-files";

const THEME_PROVIDER_JSX_PATTERN =
  /<(?:ThemeProvider|NextThemesProvider)(?:\s|>)/;

const getShellCandidates = (context: AuditContext): string[] => {
  const { project } = context;

  if (project.framework.adapter === "next-app-router" && project.paths.appDir) {
    return ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
      (fileName) => path.join(project.paths.appDir ?? "", fileName)
    );
  }

  if (project.paths.viteEntry) {
    return [project.paths.viteEntry];
  }

  return [
    "src/main.tsx",
    "src/main.jsx",
    "src/index.tsx",
    "src/index.jsx",
    "src/App.tsx",
    "src/App.jsx",
    "App.tsx",
    "App.jsx",
  ].map((fileName) => path.join(project.rootDir, fileName));
};

const themeProviderMountedInShellRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description:
    "Checks whether a theme provider is rendered by the application shell.",
  id: "theme-provider-mounted-in-shell",
  maxScore: 3,
  run: async (context) => {
    const shellCandidates = getShellCandidates(context);
    let existingShellPath: string | null = null;

    for (const shellPath of shellCandidates) {
      const shell = await readProjectSourceFile(context.project, shellPath);

      if (!shell) {
        continue;
      }

      existingShellPath = shellPath;
      const line = getTextLineNumber(shell.content, THEME_PROVIDER_JSX_PATTERN);

      if (line !== undefined) {
        return pass(
          "Theme provider is mounted in the app shell.",
          shell.path,
          line
        );
      }
    }

    if (!existingShellPath) {
      return notApplicable("No supported application shell file was found.");
    }

    return fail(
      "The application shell does not render a theme provider.",
      "Render ThemeProvider near the root so every route receives consistent theme state.",
      {
        filePath: existingShellPath,
        roast:
          "The theme provider exists spiritually. The component tree remains unconvinced.",
      }
    );
  },
  severity: "warning",
  title: "theme provider mounted in app shell",
};

export { themeProviderMountedInShellRule };
