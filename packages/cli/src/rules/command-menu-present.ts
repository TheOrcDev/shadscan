import path from "node:path";
import type { AuditRule } from "../audit";
import { findFumadocsCommandRuntime } from "./fumadocs-command-runtime";
import { getMountedComponentFilePaths } from "./mounted-component-files";
import { fail, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const COMMAND_IMPORT_PATTERN = /from\s+["'][^"']*(?:\/command|cmdk)["']/;
const COMMAND_CONTAINER_PATTERN = /<CommandDialog(?:\s|>)/;
const COMMAND_INPUT_PATTERN = /<(?:CommandInput|Command\.Input)(?:\s|>)/;
const COMMAND_EMPTY_PATTERN = /<(?:CommandEmpty|Command\.Empty)(?:\s|>)/;
const COMMAND_ITEM_PATTERN = /<(?:CommandItem|Command\.Item)(?:\s|>)/;
const GENERATED_COMMAND_FILE_PATTERN = /[/\\]ui[/\\]command\.[jt]sx?$/;

const commandMenuPresentRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "high",
  description:
    "Checks for an app-level command menu with input, empty state, and commands.",
  id: "command-menu-present",
  maxScore: 5,
  run: async ({ filesystemRoot, project }) => {
    const files = await getProjectSourceFiles(project);
    const mountedFiles = await getMountedComponentFilePaths(
      project,
      filesystemRoot
    );

    for (const file of files) {
      if (
        GENERATED_COMMAND_FILE_PATTERN.test(file.path) ||
        !mountedFiles.has(path.resolve(file.path))
      ) {
        continue;
      }

      const hasCommandImport = COMMAND_IMPORT_PATTERN.test(file.content);
      const hasContainer = COMMAND_CONTAINER_PATTERN.test(file.content);
      const hasInput = COMMAND_INPUT_PATTERN.test(file.content);
      const hasEmptyState = COMMAND_EMPTY_PATTERN.test(file.content);
      const hasItem = COMMAND_ITEM_PATTERN.test(file.content);

      if (
        hasCommandImport &&
        hasContainer &&
        hasInput &&
        hasEmptyState &&
        hasItem
      ) {
        return pass(
          "Mounted app-level command menu composition found.",
          file.path,
          getTextLineNumber(file.content, COMMAND_CONTAINER_PATTERN)
        );
      }
    }

    const fumadocsRuntime = await findFumadocsCommandRuntime(project);
    if (fumadocsRuntime) {
      return pass(
        "Mounted Fumadocs search command dialog found.",
        fumadocsRuntime.file.path,
        fumadocsRuntime.line
      );
    }

    return fail(
      "No complete mounted app-level command menu was found.",
      "Compose CommandDialog with an input, empty state, and actionable items, or mount an integrated command-search provider.",
      {
        roast:
          "Cmd+K was right there. Your users are doing cardio through the sidebar.",
      }
    );
  },
  severity: "warning",
  title: "command menu is present",
};

export { commandMenuPresentRule };
