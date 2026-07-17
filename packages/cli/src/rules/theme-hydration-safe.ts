import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import {
  fileExists,
  findSourceMatch,
  getTextLineNumber,
  readSourceFile,
} from "./source-files";

const HTML_HYDRATION_PATTERN = /<html\b[^>]*\bsuppressHydrationWarning\b/;
const CLASS_THEME_PROVIDER_PATTERN =
  /<(?:ThemeProvider|NextThemesProvider)\b[^>]*\battribute=["'{]+class["'}]+/;

const themeHydrationSafeRule: AuditRule = {
  adapters: ["next-app-router"],
  category: "foundation",
  confidence: "high",
  description:
    "Checks next-themes hydration safeguards in a Next App Router shell.",
  id: "theme-hydration-safe",
  maxScore: 2,
  run: async ({ project }) => {
    if (!project.dependencies["next-themes"]) {
      return notApplicable("next-themes is not installed in this Next app.");
    }

    const appDir = project.paths.appDir;

    if (!appDir) {
      return notApplicable("No Next App Router directory was found.");
    }

    const layoutCandidates = ["layout.tsx", "layout.jsx"].map((fileName) =>
      path.join(appDir, fileName)
    );
    let layoutPath: string | null = null;
    let hasHydrationSuppression = false;

    for (const candidate of layoutCandidates) {
      if (!(await fileExists(candidate))) {
        continue;
      }

      layoutPath = candidate;
      const layout = await readSourceFile(candidate);
      hasHydrationSuppression = HTML_HYDRATION_PATTERN.test(layout.content);
      break;
    }

    if (!layoutPath) {
      return notApplicable("No root Next layout file was found.");
    }

    const providerMatch = await findSourceMatch(
      project,
      CLASS_THEME_PROVIDER_PATTERN
    );

    if (hasHydrationSuppression && providerMatch) {
      return pass(
        "Root HTML suppresses expected theme hydration differences and the provider targets the class attribute.",
        layoutPath,
        getTextLineNumber(
          (await readSourceFile(layoutPath)).content,
          HTML_HYDRATION_PATTERN
        )
      );
    }

    const missing = [
      hasHydrationSuppression ? null : "suppressHydrationWarning on <html>",
      providerMatch ? null : 'ThemeProvider attribute="class"',
    ].filter((item): item is string => item !== null);

    return fail(
      `Unsafe theme hydration setup; missing ${missing.join(" and ")}.`,
      'Add suppressHydrationWarning to the root html element and configure next-themes with attribute="class".',
      { filePath: layoutPath }
    );
  },
  severity: "warning",
  title: "theme hydration is configured safely",
};

export { themeHydrationSafeRule };
