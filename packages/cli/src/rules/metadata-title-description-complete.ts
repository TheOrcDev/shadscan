import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import {
  fileExists,
  getProjectSourceFiles,
  getTextLineNumber,
  readSourceFile,
} from "./source-files";

const NEXT_METADATA_EXPORT_PATTERN =
  /export\s+(?:const\s+metadata|(?:async\s+)?function\s+generateMetadata)/;
const NEXT_TITLE_PATTERN = /\btitle\s*:\s*(?:["'`][^"'`]+["'`]|\{?\w+)/;
const NEXT_DESCRIPTION_PATTERN =
  /\bdescription\s*:\s*(?:["'`][^"'`]+["'`]|\{?\w+)/;
const HTML_TITLE_PATTERN = /<title>\s*[^<\s][^<]*<\/title>/i;
const HTML_DESCRIPTION_PATTERN =
  /<meta(?=[^>]*name=["']description["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i;

const metadataTitleDescriptionCompleteRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "high",
  description: "Checks for non-empty document title and description metadata.",
  id: "metadata-title-description-complete",
  maxScore: 3,
  run: async ({ project }) => {
    if (project.framework.adapter === "next-app-router") {
      const files = await getProjectSourceFiles(project);

      for (const file of files) {
        if (!NEXT_METADATA_EXPORT_PATTERN.test(file.content)) {
          continue;
        }

        const hasTitle = NEXT_TITLE_PATTERN.test(file.content);
        const hasDescription = NEXT_DESCRIPTION_PATTERN.test(file.content);

        if (hasTitle && hasDescription) {
          return pass(
            "Next metadata includes a non-empty title and description.",
            file.path,
            getTextLineNumber(file.content, NEXT_METADATA_EXPORT_PATTERN)
          );
        }

        const missing = [
          hasTitle ? null : "title",
          hasDescription ? null : "description",
        ].filter((item): item is string => item !== null);

        return fail(
          `Next metadata is missing a non-empty ${missing.join(" and ")}.`,
          "Add meaningful title and description values to metadata or generateMetadata.",
          { filePath: file.path }
        );
      }

      return fail(
        "No complete Next metadata export was found.",
        "Export metadata or generateMetadata with meaningful title and description values."
      );
    }

    const indexPath = path.join(project.rootDir, "index.html");

    if (!(await fileExists(indexPath))) {
      return notApplicable("No HTML document entry file was found.");
    }

    const document = await readSourceFile(indexPath);
    const hasTitle = HTML_TITLE_PATTERN.test(document.content);
    const hasDescription = HTML_DESCRIPTION_PATTERN.test(document.content);

    if (hasTitle && hasDescription) {
      return pass(
        "HTML metadata includes a non-empty title and description.",
        indexPath,
        getTextLineNumber(document.content, HTML_TITLE_PATTERN)
      );
    }

    return fail(
      "The HTML document is missing a non-empty title or description.",
      "Add a meaningful title element and description meta tag.",
      { filePath: indexPath }
    );
  },
  severity: "warning",
  title: "metadata title and description are complete",
};

export { metadataTitleDescriptionCompleteRule };
