import { accessibilityRules } from "./accessibility";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { highConfidenceRules } from "./high-confidence";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  themeHydrationSafeRule,
  ...accessibilityRules,
];

export { defaultRules };
