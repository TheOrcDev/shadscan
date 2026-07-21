import path from "node:path";
import { findOwnedSourceScopes, getSourceScopeMatchLine } from "../ast";
import type { AuditRule } from "../audit";
import { findFumadocsCommandRuntime } from "./fumadocs-command-runtime";
import { getMountedComponentFilePaths } from "./mounted-component-files";
import { fail, pass } from "./rule-result";

const COMMAND_HOTKEY_LIBRARY_PATTERN =
  /useHotkeys\(\s*["'](?:mod|meta|ctrl)\+k["']/i;
const KEYDOWN_PATTERN = /addEventListener\(\s*["']keydown["']|onKeyDown/;
const COMMAND_HOTKEY_TRIGGER_PATTERN =
  /useHotkeys\(\s*["'](?:mod|meta|ctrl)\+k["']|addEventListener\(\s*["']keydown["']|onKeyDown/i;
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
    const hotkeyScopes = await findOwnedSourceScopes(
      project,
      COMMAND_HOTKEY_TRIGGER_PATTERN
    );
    const mountedFiles = await getMountedComponentFilePaths(project);

    for (const scope of hotkeyScopes) {
      if (!mountedFiles.has(path.resolve(scope.file.filePath))) {
        continue;
      }

      if (COMMAND_HOTKEY_LIBRARY_PATTERN.test(scope.content)) {
        return pass(
          "Command-menu shortcut registered through a hotkey helper.",
          scope.file.filePath,
          scope.line
        );
      }

      const hasKeydown = KEYDOWN_PATTERN.test(scope.content);
      const checksK = K_KEY_PATTERN.test(scope.content);
      const checksModifier = MODIFIER_PATTERN.test(scope.content);
      const preventsDefault = PREVENT_DEFAULT_PATTERN.test(scope.content);
      const opensMenu = OPEN_ACTION_PATTERN.test(scope.content);

      if (
        hasKeydown &&
        checksK &&
        checksModifier &&
        preventsDefault &&
        opensMenu
      ) {
        return pass(
          "Cmd/Ctrl+K command-menu shortcut found.",
          scope.file.filePath,
          getSourceScopeMatchLine(scope, K_KEY_PATTERN)
        );
      }
    }

    const fumadocsRuntime = await findFumadocsCommandRuntime(project);
    if (fumadocsRuntime?.usesDefaultHotkey) {
      return pass(
        "Cmd/Ctrl+K is supplied by the mounted Fumadocs search provider.",
        fumadocsRuntime.file.path,
        fumadocsRuntime.line
      );
    }

    return fail(
      "No complete mounted Cmd/Ctrl+K command-menu shortcut was found.",
      "Register a Cmd/Ctrl+K keydown handler that prevents the browser default and toggles the command menu."
    );
  },
  severity: "warning",
  title: "command menu has a Cmd/Ctrl+K shortcut",
};

export { commandMenuHotkeyPresentRule };
