import { accessibilityRules } from "./accessibility";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { highConfidenceRules } from "./high-confidence";
import { htmlLangPresentRule } from "./html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "./metadata-title-description-complete";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  themeHydrationSafeRule,
  htmlLangPresentRule,
  metadataTitleDescriptionCompleteRule,
  ...accessibilityRules,
];

export { defaultRules };
