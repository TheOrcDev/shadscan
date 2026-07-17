import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

interface HeadingOccurrence {
  filePath: string;
  level: number;
  line: number;
}

const HEADING_PATTERN = /^h([1-6])$/;

const headingStructureSaneRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Looks for obvious heading-level skips and multiple primary headings in individual source files.",
  id: "heading-structure-sane",
  maxScore: 0,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    const headingsByFile = new Map<string, HeadingOccurrence[]>();

    visitJsxNodes(files, ({ file, node }) => {
      if (isJsxElement(node)) {
        return;
      }

      const match = getJsxTagName(node)?.match(HEADING_PATTERN);

      if (!match?.[1]) {
        return;
      }

      const headings = headingsByFile.get(file.filePath) ?? [];
      headings.push({
        filePath: file.filePath,
        level: Number(match[1]),
        line: getLineNumber(file, node),
      });
      headingsByFile.set(file.filePath, headings);
    });

    const headings = [...headingsByFile.values()].flat();

    if (headings.length === 0) {
      return notApplicable("No literal heading elements were found.");
    }

    for (const fileHeadings of headingsByFile.values()) {
      const secondPrimaryHeading = fileHeadings.filter(
        (heading) => heading.level === 1
      )[1];

      if (secondPrimaryHeading) {
        return fail(
          "This source file renders more than one h1.",
          "Render one page-level h1, then use h2-h6 in a logical outline. Verify the composed route in a browser.",
          {
            filePath: secondPrimaryHeading.filePath,
            line: secondPrimaryHeading.line,
          }
        );
      }

      for (let index = 1; index < fileHeadings.length; index += 1) {
        const previous = fileHeadings[index - 1];
        const current = fileHeadings[index];

        if (previous && current && current.level > previous.level + 1) {
          return fail(
            `Heading order jumps from h${previous.level} to h${current.level}.`,
            "Use the next heading level unless the rendered document outline supplies the missing level. Verify the composed route in a browser.",
            { filePath: current.filePath, line: current.line }
          );
        }
      }
    }

    return pass(
      `No obvious heading-order problems were found across ${headings.length} headings.`
    );
  },
  severity: "warning",
  title: "rendered heading structure is logical",
};

export { headingStructureSaneRule };
