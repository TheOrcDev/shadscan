import path from "node:path";
import type { AuditContext, AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getTextLineNumber, readProjectSourceFile } from "./source-files";

const THEME_PROVIDER_JSX_PATTERN =
  /<(?:ThemeProvider|NextThemesProvider)(?:\s|>)/;

interface ShellCandidateGroup {
  label: string;
  paths: string[];
}

const getShellCandidateGroups = (
  context: AuditContext
): ShellCandidateGroup[] => {
  const { project } = context;
  const groups: ShellCandidateGroup[] = [];

  if (project.versions.next && project.paths.appDir) {
    groups.push({
      label: "App Router",
      paths: ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
        (fileName) => path.join(project.paths.appDir ?? "", fileName)
      ),
    });
  }

  if (project.versions.next && project.paths.pagesDir) {
    groups.push({
      label: "Pages Router",
      paths: ["_app.tsx", "_app.jsx", "_app.ts", "_app.js"].map((fileName) =>
        path.join(project.paths.pagesDir ?? "", fileName)
      ),
    });
  }

  if (project.versions.tanstackStart && project.paths.routesDir) {
    groups.push({
      label: "TanStack Start root route",
      paths: ["__root.tsx", "__root.jsx", "__root.ts", "__root.js"].map(
        (fileName) => path.join(project.paths.routesDir ?? "", fileName)
      ),
    });
  }

  if (project.versions.inertia && project.paths.inertiaPagesDir) {
    groups.push({
      label: "Inertia app shell",
      paths: [
        "resources/js/app.tsx",
        "resources/js/app.jsx",
        "resources/js/ssr.tsx",
        "resources/js/layouts/app-layout.tsx",
        "resources/js/Layouts/AppLayout.tsx",
      ].map((fileName) => path.join(project.rootDir, fileName)),
    });
  }

  if (groups.length > 0) {
    return groups;
  }

  if (project.paths.viteEntry) {
    return [{ label: "application", paths: [project.paths.viteEntry] }];
  }

  return [
    {
      label: "application",
      paths: [
        "src/main.tsx",
        "src/main.jsx",
        "src/index.tsx",
        "src/index.jsx",
        "src/App.tsx",
        "src/App.jsx",
        "App.tsx",
        "App.jsx",
      ].map((fileName) => path.join(project.rootDir, fileName)),
    },
  ];
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
    const shellGroups = getShellCandidateGroups(context);
    let inspectedShells = 0;
    let passingPath: string | null = null;
    let passingLine: number | undefined;

    for (const group of shellGroups) {
      for (const shellPath of group.paths) {
        const shell = await readProjectSourceFile(context.project, shellPath);

        if (!shell) {
          continue;
        }

        inspectedShells += 1;
        const line = getTextLineNumber(
          shell.content,
          THEME_PROVIDER_JSX_PATTERN
        );

        if (line === undefined) {
          return fail(
            `The ${group.label} shell does not render a theme provider.`,
            "Render ThemeProvider near the root so every route receives consistent theme state.",
            {
              filePath: shellPath,
              roast:
                "The theme provider exists spiritually. The component tree remains unconvinced.",
            }
          );
        }

        passingPath ??= shell.path;
        passingLine ??= line;
        break;
      }
    }

    if (inspectedShells === 0) {
      return notApplicable("No supported application shell file was found.");
    }

    return pass(
      inspectedShells > 1
        ? "Theme provider is mounted in every application shell."
        : "Theme provider is mounted in the app shell.",
      passingPath ?? undefined,
      passingLine
    );
  },
  severity: "warning",
  title: "theme provider mounted in app shell",
};

export { themeProviderMountedInShellRule };
