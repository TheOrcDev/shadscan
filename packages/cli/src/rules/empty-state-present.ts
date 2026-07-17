import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const DATA_COLLECTION_PATTERN =
  /(?:useQuery|useInfiniteQuery|<TableBody|<DataTable|\b(?:data|items|rows|results|records|projects|users|notifications)\??\.map\s*\()/i;
const EMPTY_STATE_PATTERN =
  /<(?:Empty|\w*EmptyState)(?:\s|>)|\b(?:data|items|rows|results|records|projects|users|notifications)\??\.length\s*===?\s*0|!\s*(?:data|items|rows|results|records|projects|users|notifications)\??\.length|\b(?:No|Nothing)\s+(?:here|yet|found|available|to show|items|results|records|projects|users|notifications|data)\b/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

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
        !DATA_COLLECTION_PATTERN.test(file.content)
      ) {
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
          line: getTextLineNumber(file.content, DATA_COLLECTION_PATTERN),
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
