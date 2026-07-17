import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const COMMAND_HOTKEY_LIBRARY_PATTERN =
  /useHotkeys\(\s*["'](?:mod|meta|ctrl)\+k["']/i;
const KEYDOWN_PATTERN = /addEventListener\(\s*["']keydown["']|onKeyDown/;
const K_KEY_PATTERN = /(?:key\.toLowerCase\(\)|key)\s*(?:===|!==)\s*["']k["']/;
const MODIFIER_PATTERN =
  /(?:metaKey\s*\|\|\s*\w*\.?ctrlKey|ctrlKey\s*\|\|\s*\w*\.?metaKey|metaKey\s*&&|ctrlKey\s*&&)/;
const PREVENT_DEFAULT_PATTERN = /preventDefault\(\)/;
const OPEN_ACTION_PATTERN =
  /(?:set\w*(?:Open|Command)\s*\(|toggle\w*\s*\(|dispatchEvent\s*\()/;

const commandMenuHotkeyPresentRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "high",
  description:
    "Checks for a Cmd/Ctrl+K command-menu shortcut that intercepts the browser default.",
  id: "command-menu-hotkey-present",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await getProjectSourceFiles(project);

    for (const file of files) {
      const libraryLine = getTextLineNumber(
        file.content,
        COMMAND_HOTKEY_LIBRARY_PATTERN
      );

      if (libraryLine !== undefined) {
        return pass(
          "Command-menu shortcut registered through a hotkey helper.",
          file.path,
          libraryLine
        );
      }

      const hasKeydown = KEYDOWN_PATTERN.test(file.content);
      const checksK = K_KEY_PATTERN.test(file.content);
      const checksModifier = MODIFIER_PATTERN.test(file.content);
      const preventsDefault = PREVENT_DEFAULT_PATTERN.test(file.content);
      const opensMenu = OPEN_ACTION_PATTERN.test(file.content);

      if (
        hasKeydown &&
        checksK &&
        checksModifier &&
        preventsDefault &&
        opensMenu
      ) {
        return pass(
          "Cmd/Ctrl+K command-menu shortcut found.",
          file.path,
          getTextLineNumber(file.content, KEYDOWN_PATTERN)
        );
      }
    }

    return fail(
      "No complete Cmd/Ctrl+K command-menu shortcut was found.",
      "Register a Cmd/Ctrl+K keydown handler that prevents the browser default and toggles the command menu."
    );
  },
  severity: "warning",
  title: "command menu has a Cmd/Ctrl+K shortcut",
};

export { commandMenuHotkeyPresentRule };
