import type { ProjectDiscovery } from "../discovery";
import {
  getProjectSourceFiles,
  getTextLineNumber,
  type SourceFile,
} from "./source-files";

interface FumadocsCommandRuntime {
  file: SourceFile;
  line: number | undefined;
  usesDefaultHotkey: boolean;
}

const SEARCH_IMPORT_PATTERN =
  /from\s+["']fumadocs-ui\/components\/dialog\/search["']/;
const SEARCH_DIALOG_PATTERN = /<SearchDialog(?:\s|>)/;
const SEARCH_INPUT_PATTERN = /<SearchDialogInput(?:\s|>)/;
const SEARCH_LIST_PATTERN = /<SearchDialogList(?:\s|>)/;
const ROOT_PROVIDER_IMPORT_PATTERN =
  /from\s+["']fumadocs-ui\/provider(?:\/next)?["']/;
const MOUNTED_SEARCH_PATTERN =
  /<RootProvider\b[\s\S]*?\bsearch\s*=\s*\{\s*\{[\s\S]{0,500}\bSearchDialog\b[\s\S]{0,500}\}\s*\}/;
const HOTKEY_OVERRIDE_PATTERN = /\bhotKey\s*:/;

const isCompleteSearchDialog = (file: SourceFile): boolean =>
  SEARCH_IMPORT_PATTERN.test(file.content) &&
  SEARCH_DIALOG_PATTERN.test(file.content) &&
  SEARCH_INPUT_PATTERN.test(file.content) &&
  SEARCH_LIST_PATTERN.test(file.content);

const findFumadocsCommandRuntime = async (
  project: ProjectDiscovery
): Promise<FumadocsCommandRuntime | null> => {
  if (!project.dependencies["fumadocs-ui"]) {
    return null;
  }

  const files = await getProjectSourceFiles(project);
  const hasCompleteDialog = files.some(isCompleteSearchDialog);

  if (!hasCompleteDialog) {
    return null;
  }

  const providerFile = files.find(
    (file) =>
      ROOT_PROVIDER_IMPORT_PATTERN.test(file.content) &&
      MOUNTED_SEARCH_PATTERN.test(file.content)
  );

  if (!providerFile) {
    return null;
  }

  return {
    file: providerFile,
    line: getTextLineNumber(providerFile.content, MOUNTED_SEARCH_PATTERN),
    usesDefaultHotkey: !HOTKEY_OVERRIDE_PATTERN.test(providerFile.content),
  };
};

export type { FumadocsCommandRuntime };
export { findFumadocsCommandRuntime };
