import {
  isCallExpression,
  isIdentifier,
  isJsxElement,
  isJsxExpression,
  isPropertyAccessExpression,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  walkNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getTextLineNumber } from "./source-files";

const QUERY_COLLECTION_PATTERN = /\b(?:useQuery|useInfiniteQuery)\s*\(/i;
const EMPTY_STATE_PATTERN =
  /<(?:Empty|\w*EmptyState)(?:\s|>)|\b(?:data|items|rows|results|records|projects|users|notifications)\??\.length\s*===?\s*0|!\s*(?:data|items|rows|results|records|projects|users|notifications)\??\.length|\b(?:No|Nothing)\s+(?:here|yet|found|available|to show|items|results|records|projects|users|notifications|data)\b/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const TOOLTIP_PATH_PATTERN = /(?:^|[/\\])tooltips?(?:[/\\]|[.-])/i;
const JSX_SOURCE_PATH_PATTERN = /\.[jt]sx$/i;
const JAVASCRIPT_SOURCE_PATH_PATTERN = /\.[cm]?js$/i;
const JSX_ELEMENT_PATTERN = /<[A-Za-z][\w.:-]*(?:\s|\/?>)/;
const CREATE_ELEMENT_PATTERN = /\b(?:React\.)?createElement\s*\(/;
const CREATE_ELEMENT_CALL_PATTERN = /^(?:React\.)?createElement$/;
const COLLECTION_NAMES = new Set([
  "data",
  "notifications",
  "projects",
  "records",
  "results",
  "rows",
  "users",
]);
const SVG_COLLECTION_CONTAINERS = new Set([
  "clipPath",
  "defs",
  "g",
  "mask",
  "pattern",
  "svg",
]);

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isStaticLocalCollection = (content: string, name: string): boolean =>
  new RegExp(
    `\\b(?:const|let|var)\\s+${escapeRegex(name)}(?:\\s*:[^=;]+)?\\s*=\\s*(?:\\[|Array\\.from\\s*\\()`,
    "i"
  ).test(content);

const isUiSourceFile = (path: string, content: string): boolean =>
  JSX_SOURCE_PATH_PATTERN.test(path) ||
  (JAVASCRIPT_SOURCE_PATH_PATTERN.test(path) &&
    (JSX_ELEMENT_PATTERN.test(content) ||
      CREATE_ELEMENT_PATTERN.test(content)));

interface CollectionEvidence {
  line?: number;
}

const getRenderedCollectionMap = (
  file: ParsedSourceFile
): CollectionEvidence | null => {
  let evidence: CollectionEvidence | null = null;

  walkNodes(file.sourceFile, (node, ancestors) => {
    if (
      evidence ||
      !isCallExpression(node) ||
      !isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "map" ||
      !isIdentifier(node.expression.expression) ||
      !COLLECTION_NAMES.has(node.expression.expression.text) ||
      isStaticLocalCollection(file.content, node.expression.expression.text)
    ) {
      return;
    }

    const isRenderedByJsx = ancestors.some((ancestor) =>
      isJsxExpression(ancestor)
    );
    const isInsideSvgContainer = ancestors.some(
      (ancestor) =>
        isJsxElement(ancestor) &&
        SVG_COLLECTION_CONTAINERS.has(
          getJsxTagName(ancestor.openingElement) ?? ""
        )
    );
    const isRenderedByCreateElement = ancestors.some(
      (ancestor) =>
        isCallExpression(ancestor) &&
        CREATE_ELEMENT_CALL_PATTERN.test(ancestor.expression.getText())
    );

    if (
      !isInsideSvgContainer &&
      (isRenderedByJsx || isRenderedByCreateElement)
    ) {
      evidence = { line: getLineNumber(file, node) };
    }
  });

  return evidence;
};

const getCollectionEvidence = (
  file: ParsedSourceFile
): CollectionEvidence | null => {
  const { content } = file;

  if (QUERY_COLLECTION_PATTERN.test(content)) {
    return { line: getTextLineNumber(content, QUERY_COLLECTION_PATTERN) };
  }

  return getRenderedCollectionMap(file);
};

const emptyStatePresentRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "medium",
  description:
    "Checks recognizable data-backed collections for an explicit empty state.",
  id: "empty-state-present",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let collectionCount = 0;

    for (const file of files) {
      if (
        GENERATED_UI_PATH_PATTERN.test(file.filePath) ||
        TOOLTIP_PATH_PATTERN.test(file.filePath) ||
        !isUiSourceFile(file.filePath, file.content)
      ) {
        continue;
      }

      const collectionEvidence = getCollectionEvidence(file);

      if (!collectionEvidence) {
        continue;
      }

      collectionCount += 1;

      if (EMPTY_STATE_PATTERN.test(file.content)) {
        continue;
      }

      return fail(
        "Data-backed collection has no explicit empty state.",
        "Render a clear empty-state title or message, plus a useful next action when one exists.",
        {
          filePath: file.filePath,
          line: collectionEvidence.line,
          roast:
            "Your users found nothing, and then your app found nothing to say.",
        }
      );
    }

    if (collectionCount === 0) {
      return notApplicable("No recognizable data-backed collection was found.");
    }

    return pass(
      `All ${collectionCount} detected collection surfaces have empty states.`
    );
  },
  severity: "warning",
  title: "data collections have empty states",
};

export { emptyStatePresentRule };
