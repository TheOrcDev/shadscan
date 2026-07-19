import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isJsxElement,
  isMethodDeclaration,
  isReturnStatement,
  type Node,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

interface HeadingOccurrence {
  filePath: string;
  level: number;
  line: number;
  position: number;
  scopeKey: string;
}

const COMPOSED_CONTENT_PATTERN =
  /(?:^|\.)(?:mdx(?:content)?|markdown(?:content)?)$/i;
const HEADING_PATTERN = /^h([1-6])$/;

const isFunctionOwner = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getRenderScopeKey = (
  file: ParsedSourceFile,
  ancestors: Node[]
): string => {
  const owner = ancestors.findLast((ancestor) => isFunctionOwner(ancestor));
  const ownerPosition = owner?.getStart(file.sourceFile) ?? 0;
  const returnStatement = ancestors.findLast(
    (ancestor) =>
      isReturnStatement(ancestor) &&
      (!owner || ancestor.getStart(file.sourceFile) >= ownerPosition)
  );
  const returnPosition = returnStatement?.getStart(file.sourceFile) ?? -1;

  return `${file.filePath}:${ownerPosition}:${returnPosition}`;
};

const headingStructureSaneRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Looks for obvious heading-level skips and multiple primary headings in individual render branches.",
  id: "heading-structure-sane",
  maxScore: 0,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    const compositionBoundariesByScope = new Map<string, number[]>();
    const headingsByScope = new Map<string, HeadingOccurrence[]>();

    visitJsxNodes(files, ({ ancestors, file, node }) => {
      if (isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node);
      const scopeKey = getRenderScopeKey(file, ancestors);

      if (tagName && COMPOSED_CONTENT_PATTERN.test(tagName)) {
        const boundaries = compositionBoundariesByScope.get(scopeKey) ?? [];
        boundaries.push(node.getStart(file.sourceFile));
        compositionBoundariesByScope.set(scopeKey, boundaries);
      }

      const match = tagName?.match(HEADING_PATTERN);

      if (!match?.[1]) {
        return;
      }

      const headings = headingsByScope.get(scopeKey) ?? [];
      headings.push({
        filePath: file.filePath,
        level: Number(match[1]),
        line: getLineNumber(file, node),
        position: node.getStart(file.sourceFile),
        scopeKey,
      });
      headingsByScope.set(scopeKey, headings);
    });

    const headings = [...headingsByScope.values()].flat();

    if (headings.length === 0) {
      return notApplicable("No literal heading elements were found.");
    }

    for (const scopeHeadings of headingsByScope.values()) {
      const secondPrimaryHeading = scopeHeadings.filter(
        (heading) => heading.level === 1
      )[1];

      if (secondPrimaryHeading) {
        return fail(
          "This render branch contains more than one h1.",
          "Render one page-level h1, then use h2-h6 in a logical outline. Verify the composed route in a browser.",
          {
            filePath: secondPrimaryHeading.filePath,
            line: secondPrimaryHeading.line,
          }
        );
      }

      for (let index = 1; index < scopeHeadings.length; index += 1) {
        const previous = scopeHeadings[index - 1];
        const current = scopeHeadings[index];

        if (!(previous && current)) {
          continue;
        }

        const hasComposedContentBetween = (
          compositionBoundariesByScope.get(current.scopeKey) ?? []
        ).some(
          (position) =>
            position > previous.position && position < current.position
        );

        if (!hasComposedContentBetween && current.level > previous.level + 1) {
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
