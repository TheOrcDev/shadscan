import path from "node:path";
import type { AuditRule } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import { fail, notApplicable, pass } from "./rule-result";
import {
  findSourceMatch,
  getTextLineNumber,
  readProjectSourceFile,
  type SourceFile,
} from "./source-files";

const HTML_HYDRATION_PATTERN = /<html\b[^>]*\bsuppressHydrationWarning\b/;
const CLASS_THEME_PROVIDER_PATTERN =
  /<(?:ThemeProvider|NextThemesProvider)\b[^>]*\battribute=["'{]+class["'}]+/;

const findDocumentShell = async (
  project: ProjectDiscovery
): Promise<SourceFile | null> => {
  const shellCandidates: string[] = [];
  const { appDir, routesDir } = project.paths;

  if (project.versions.next && appDir) {
    shellCandidates.push(
      path.join(appDir, "layout.tsx"),
      path.join(appDir, "layout.jsx")
    );
  }

  if (project.versions.tanstackStart && routesDir) {
    shellCandidates.push(
      path.join(routesDir, "__root.tsx"),
      path.join(routesDir, "__root.jsx")
    );
  }

  if (project.paths.reactRouterRoot) {
    shellCandidates.push(project.paths.reactRouterRoot);
  }

  for (const candidate of shellCandidates) {
    const shell = await readProjectSourceFile(project, candidate);

    if (shell) {
      return shell;
    }
  }

  return null;
};

const themeHydrationSafeRule: AuditRule = {
  adapters: [
    "next-app-router",
    "next-hybrid-router",
    "react-router-framework",
    "tanstack-start",
  ],
  category: "foundation",
  confidence: "high",
  description:
    "Checks next-themes hydration safeguards in a Next App Router or TanStack Start document shell.",
  id: "theme-hydration-safe",
  maxScore: 2,
  run: async ({ project }) => {
    if (!project.dependencies["next-themes"]) {
      return notApplicable("next-themes is not installed in this app.");
    }

    const shell = await findDocumentShell(project);

    if (!shell) {
      return notApplicable("No root document shell file was found.");
    }

    const hasHydrationSuppression = HTML_HYDRATION_PATTERN.test(shell.content);
    const providerMatch = await findSourceMatch(
      project,
      CLASS_THEME_PROVIDER_PATTERN
    );

    if (hasHydrationSuppression && providerMatch) {
      return pass(
        "Root HTML suppresses expected theme hydration differences and the provider targets the class attribute.",
        shell.path,
        getTextLineNumber(shell.content, HTML_HYDRATION_PATTERN)
      );
    }

    const missing = [
      hasHydrationSuppression ? null : "suppressHydrationWarning on <html>",
      providerMatch ? null : 'ThemeProvider attribute="class"',
    ].filter((item): item is string => item !== null);

    return fail(
      `Unsafe theme hydration setup; missing ${missing.join(" and ")}.`,
      'Add suppressHydrationWarning to the root html element and configure next-themes with attribute="class".',
      { filePath: shell.path }
    );
  },
  severity: "warning",
  title: "theme hydration is configured safely",
};

export { themeHydrationSafeRule };
