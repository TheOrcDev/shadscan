import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const GLOBAL_KEYDOWN_PATTERN =
  /(?:window|document)\.addEventListener\(\s*["']keydown["']/;
const REMOVE_KEYDOWN_PATTERN =
  /(?:window|document)\.removeEventListener\(\s*["']keydown["']/;
const BARE_KEY_PATTERN =
  /(?:key\.toLowerCase\(\)|key)\s*(?:===|!==)\s*["'][a-z]["']/i;
const MODIFIER_PATTERN = /(?:metaKey|ctrlKey|altKey)/;
const TYPING_TARGET_PATTERN =
  /(?:INPUT|TEXTAREA|SELECT|isContentEditable|closest\(\s*["'][^"']*(?:input|textarea|select))/i;

const globalHotkeysAreSafeRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks global keyboard listeners for cleanup and typing-target guards.",
  id: "global-hotkeys-are-safe",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await getProjectSourceFiles(project);

    for (const file of files) {
      if (!GLOBAL_KEYDOWN_PATTERN.test(file.content)) {
        continue;
      }

      const hasCleanup = REMOVE_KEYDOWN_PATTERN.test(file.content);

      if (!hasCleanup) {
        return fail(
          "Global keydown listener has no matching cleanup.",
          "Remove the keydown listener when the owning component or effect is disposed.",
          {
            filePath: file.path,
            line: getTextLineNumber(file.content, GLOBAL_KEYDOWN_PATTERN),
          }
        );
      }

      const hasBareKey = BARE_KEY_PATTERN.test(file.content);
      const hasModifier = MODIFIER_PATTERN.test(file.content);
      const guardsTypingTargets = TYPING_TARGET_PATTERN.test(file.content);

      if (hasBareKey && !hasModifier && !guardsTypingTargets) {
        return fail(
          "Bare-key global shortcut can fire while the user is typing.",
          "Ignore input, textarea, select, and contenteditable targets before handling bare-key shortcuts.",
          {
            filePath: file.path,
            line: getTextLineNumber(file.content, BARE_KEY_PATTERN),
          }
        );
      }
    }

    return pass("No unsafe global keyboard listeners were found.");
  },
  severity: "warning",
  title: "global keyboard shortcuts are safe",
};

export { globalHotkeysAreSafeRule };
