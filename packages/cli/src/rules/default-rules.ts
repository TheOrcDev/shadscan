import { accessibilityRules } from "./accessibility";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { highConfidenceRules } from "./high-confidence";
import { htmlLangPresentRule } from "./html-lang-present";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  themeHydrationSafeRule,
  htmlLangPresentRule,
  ...accessibilityRules,
];

export { defaultRules };
