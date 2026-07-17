import { accessibilityRules } from "./accessibility";
import { commandMenuHotkeyPresentRule } from "./command-menu-hotkey-present";
import { commandMenuPresentRule } from "./command-menu-present";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { globalHotkeysAreSafeRule } from "./global-hotkeys-are-safe";
import { highConfidenceRules } from "./high-confidence";
import { htmlLangPresentRule } from "./html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "./metadata-title-description-complete";
import { noStarterCopyRule } from "./no-starter-copy";
import { socialPreviewPresentRule } from "./social-preview-present";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  themeHydrationSafeRule,
  htmlLangPresentRule,
  metadataTitleDescriptionCompleteRule,
  socialPreviewPresentRule,
  noStarterCopyRule,
  commandMenuPresentRule,
  commandMenuHotkeyPresentRule,
  globalHotkeysAreSafeRule,
  ...accessibilityRules,
];

export { defaultRules };
