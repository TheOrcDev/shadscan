import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const QUERY_COLLECTION_PATTERN = /\b(?:useQuery|useInfiniteQuery)\s*\(/i;
const MAPPED_COLLECTION_PATTERN =
  /(?<![\w.])(data|rows|results|records|projects|users|notifications)\??\.map\s*\(/gi;
const EMPTY_STATE_PATTERN =
  /<(?:Empty|\w*EmptyState)(?:\s|>)|\b(?:data|items|rows|results|records|projects|users|notifications)\??\.length\s*===?\s*0|!\s*(?:data|items|rows|results|records|projects|users|notifications)\??\.length|\b(?:No|Nothing)\s+(?:here|yet|found|available|to show|items|results|records|projects|users|notifications|data)\b/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const JSX_SOURCE_PATH_PATTERN = /\.[jt]sx$/i;
const JAVASCRIPT_SOURCE_PATH_PATTERN = /\.[cm]?js$/i;
const JSX_ELEMENT_PATTERN = /<[A-Za-z][\w.:-]*(?:\s|\/?>)/;
const CREATE_ELEMENT_PATTERN = /\b(?:React\.)?createElement\s*\(/;

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

const getCollectionPattern = (content: string): RegExp | null => {
  if (QUERY_COLLECTION_PATTERN.test(content)) {
    return QUERY_COLLECTION_PATTERN;
  }

  MAPPED_COLLECTION_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(MAPPED_COLLECTION_PATTERN)) {
    const collectionName = match[1];

    if (collectionName && !isStaticLocalCollection(content, collectionName)) {
      return new RegExp(
        `(?<![\\w.])${escapeRegex(collectionName)}\\??\\.map\\s*\\(`,
        "i"
      );
    }
  }

  return null;
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
    const files = await getProjectSourceFiles(project);
    let collectionCount = 0;

    for (const file of files) {
      if (
        GENERATED_UI_PATH_PATTERN.test(file.path) ||
        !isUiSourceFile(file.path, file.content)
      ) {
        continue;
      }

      const collectionPattern = getCollectionPattern(file.content);

      if (!collectionPattern) {
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
          filePath: file.path,
          line: getTextLineNumber(file.content, collectionPattern),
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
