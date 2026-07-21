import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getTextLineNumber, readProjectSourceFile } from "./source-files";

const HTML_LANG_PATTERN = /<html\b[^>]*\blang=(?:["'][^"']+["']|\{[^}]+\})/i;

const getDocumentCandidates = ({
  framework,
  paths,
  rootDir,
}: {
  framework: {
    adapter:
      | "generic-react"
      | "next-app-router"
      | "next-pages-router"
      | "vite-react";
  };
  paths: { appDir: string | null; pagesDir: string | null };
  rootDir: string;
}): string[] => {
  if (framework.adapter === "next-app-router" && paths.appDir) {
    return ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
      (fileName) => path.join(paths.appDir ?? "", fileName)
    );
  }

  if (framework.adapter === "next-pages-router" && paths.pagesDir) {
    return [
      "_document.tsx",
      "_document.jsx",
      "_document.ts",
      "_document.js",
    ].map((fileName) => path.join(paths.pagesDir ?? "", fileName));
  }

  return [path.join(rootDir, "index.html")];
};

const htmlLangPresentRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks whether the document root declares a language.",
  id: "html-lang-present",
  maxScore: 2,
  run: async ({ project }) => {
    const candidates = getDocumentCandidates(project);
    let documentPath: string | null = null;

    for (const candidate of candidates) {
      const document = await readProjectSourceFile(project, candidate);

      if (!document) {
        continue;
      }

      documentPath = candidate;
      const line = getTextLineNumber(document.content, HTML_LANG_PATTERN);

      if (line !== undefined) {
        return pass("Document language is declared.", candidate, line);
      }
    }

    if (!documentPath) {
      return notApplicable("No document shell owned by the app was found.");
    }

    return fail(
      "The root html element does not declare a language.",
      "Add a non-empty lang attribute to the root html element.",
      { filePath: documentPath }
    );
  },
  severity: "error",
  title: "document language is declared",
};

export { htmlLangPresentRule };
