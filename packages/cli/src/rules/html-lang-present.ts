import path from "node:path";
import type { AuditRule } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import { fail, notApplicable, pass } from "./rule-result";
import { getTextLineNumber, readProjectSourceFile } from "./source-files";

const HTML_LANG_PATTERN = /<html\b[^>]*\blang=(?:["'][^"']+["']|\{[^}]+\})/i;

interface DocumentCandidateGroup {
  label: string;
  paths: string[];
}

const getDocumentCandidateGroups = (
  project: ProjectDiscovery
): DocumentCandidateGroup[] => {
  const groups: DocumentCandidateGroup[] = [];

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
      paths: [
        "_document.tsx",
        "_document.jsx",
        "_document.ts",
        "_document.js",
      ].map((fileName) => path.join(project.paths.pagesDir ?? "", fileName)),
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

  if (project.paths.bladeRootView) {
    groups.push({
      label: "Laravel Blade root view",
      paths: [project.paths.bladeRootView],
    });
  }

  return groups.length > 0
    ? groups
    : [
        {
          label: "application",
          paths: [path.join(project.rootDir, "index.html")],
        },
      ];
};

const htmlLangPresentRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks whether the document root declares a language.",
  id: "html-lang-present",
  maxScore: 2,
  run: async ({ project }) => {
    const groups = getDocumentCandidateGroups(project);
    let inspectedDocuments = 0;
    let passingPath: string | null = null;
    let passingLine: number | undefined;

    for (const group of groups) {
      for (const candidate of group.paths) {
        const document = await readProjectSourceFile(project, candidate);

        if (!document) {
          continue;
        }

        inspectedDocuments += 1;
        const line = getTextLineNumber(document.content, HTML_LANG_PATTERN);

        if (line === undefined) {
          return fail(
            `The ${group.label} document root does not declare a language.`,
            "Add a non-empty lang attribute to the root html element.",
            { filePath: candidate }
          );
        }

        passingPath ??= candidate;
        passingLine ??= line;
        break;
      }
    }

    if (inspectedDocuments === 0) {
      return notApplicable("No document shell owned by the app was found.");
    }

    return pass(
      inspectedDocuments > 1
        ? "Every owned document shell declares a language."
        : "Document language is declared.",
      passingPath ?? undefined,
      passingLine
    );
  },
  severity: "error",
  title: "document language is declared",
};

export { htmlLangPresentRule };
